/**
 * "Ask about this product": an agent with two tools, gated by plan and quota,
 * traced into Postgres so the admin page can show what every run did and cost.
 */
import { z } from "zod";
import {
  Tracer,
  defineTool,
  runAgent,
  type AgentEvent,
  type AgentResult,
  type ModelProvider,
  type Run,
  type TraceExporter,
} from "agent-runtime";
import { AnthropicProvider } from "agent-runtime/anthropic";
import type { Product, User } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { canUse } from "@/domain/plans";
import { HashEmbedder, VoyageEmbedder, retrieve, type ChunkSearch, type Embedder } from "@/rag";
import { entitlementsForUser } from "./billing";
import { meter } from "./usage";

export class PrismaTraceExporter implements TraceExporter {
  constructor(private readonly meta: { userId?: string; productId?: string }) {}
  async export(run: Run) {
    await db.agentTrace.create({
      data: {
        runId: run.id,
        userId: this.meta.userId ?? null,
        productId: this.meta.productId ?? null,
        status: run.status,
        modelCalls: run.totals.modelCalls,
        toolCalls: run.totals.toolCalls,
        inputTokens: run.totals.usage.inputTokens,
        outputTokens: run.totals.usage.outputTokens,
        costUsd: run.totals.costUsd,
        durationMs: run.durationMs ?? 0,
        spans: JSON.parse(JSON.stringify(run.spans)),
      },
    });
  }
}

let modelOverride: ModelProvider | null = null;
let embedderOverride: Embedder | null = null;
export function setModelProviderForTests(p: ModelProvider | null) {
  modelOverride = p;
}
export function setEmbedderForTests(e: Embedder | null) {
  embedderOverride = e;
}

function modelProvider(): ModelProvider {
  if (modelOverride) return modelOverride;
  if (!env().ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  return new AnthropicProvider({ model: "claude-opus-5", effort: "medium", maxTokens: 4_000 });
}

export function embedder(): Embedder {
  if (embedderOverride) return embedderOverride;
  const key = env().VOYAGE_API_KEY;
  // No key → bag-of-words hashing. Fine for local demos, useless for real search.
  return key ? new VoyageEmbedder(key) : new HashEmbedder();
}

export class AssistantGateError extends Error {
  constructor(readonly status: 403 | 429, message: string, readonly detail?: unknown) {
    super(message);
    this.name = "AssistantGateError";
  }
}

/** What the agent needs to know about the listing. */
export type AssistantProduct = Pick<Product, "id" | "title" | "priceMinor" | "currency" | "status"> & { seller: { name: string } };

export interface AssistantAgentOptions {
  embedder?: Embedder;
  /** Where search_docs looks. Defaults to pgvector; the eval harness passes an in-memory index. */
  search?: ChunkSearch;
}

/**
 * The prompt and tools, with no gate, quota or tracer around them. Split out
 * so the eval suite in `evals/` grades the agent the ask box actually runs
 * rather than a copy of it that drifts.
 */
export function assistantAgent(product: AssistantProduct, options: AssistantAgentOptions = {}) {
  const searchDocs = defineTool({
    name: "search_docs",
    description: "Search the product's own documentation. Returns numbered passages to cite.",
    input: z.object({ query: z.string().min(1).describe("What to look for, in the document's language") }),
    execute: async ({ query }) => {
      const passages = await retrieve(product.id, query, options.embedder ?? embedder(), { k: 5, ...(options.search ? { search: options.search } : {}) });
      if (passages.length === 0) return "No passages found.";
      return passages.map((p) => `[${p.index}]${p.heading ? ` (${p.heading})` : ""} ${p.content}`).join("\n\n");
    },
  });

  const productFacts = defineTool({
    name: "product_facts",
    description: "Listing facts: title, price, seller, status.",
    input: z.object({}),
    execute: () => ({
      title: product.title,
      price: `${(product.priceMinor / 100).toFixed(2)} ${product.currency.toUpperCase()}`,
      seller: product.seller.name,
      status: product.status,
    }),
  });

  const system = [
    `You answer buyers' questions about the digital product "${product.title}".`,
    "Use search_docs for anything about the product's contents and cite passages as [n].",
    "Use product_facts for price, seller, or availability.",
    "If the documents do not contain the answer, say so plainly — never invent contents.",
    "Reply in the language the user wrote in.",
  ].join(" ");

  return { system, tools: [searchDocs, productFacts], maxIterations: 6 };
}

export interface AskInput {
  user: User;
  product: Product & { seller: { name: string } };
  question: string;
  onEvent?: (e: AgentEvent) => void;
}

export async function askAboutProduct({ user, product, question, onEvent }: AskInput): Promise<AgentResult> {
  // Gate 1: does the plan include the feature. Gate 2: is there quota left.
  const entitlements = await entitlementsForUser(user.id);
  if (!canUse(entitlements, "ask_ai")) throw new AssistantGateError(403, "not included in your plan");
  const usage = await meter(user.id, "aiMessages", entitlements.quotas.aiMessages);
  if (!usage.allowed) throw new AssistantGateError(429, "monthly AI quota exceeded", usage);

  return runAgent({
    provider: modelProvider(),
    ...assistantAgent(product),
    input: question,
    tracer: new Tracer({ exporters: [new PrismaTraceExporter({ userId: user.id, productId: product.id })] }),
    runName: `ask:${product.slug}`,
    ...(onEvent ? { onEvent } : {}),
  });
}
