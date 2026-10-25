/**
 * "Draft it for me" on the sell page: one model call that turns the words a
 * seller typed into the other locale's fields, which they then edit and
 * submit. Nothing here writes a translation — the draft goes back to the form
 * and is a row only once the seller posts it with everything else.
 */
import { Tracer, runAgent, type ModelProvider } from "agent-runtime";
import { AnthropicProvider } from "agent-runtime/anthropic";
import type { User } from "@prisma/client";
import { env } from "@/lib/env";
import { draftInput, draftSystem, parseDraft } from "@/domain/translation";
import type { ListingText } from "@/domain/listing";
import { fakesRequested, untranslatedDraft } from "@/providers/fake";
import { AssistantGateError, PrismaTraceExporter } from "./assistant";
import { entitlementsForUser } from "./billing";
import { meter, refundMeter } from "./usage";

export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftError";
  }
}

export interface DraftInput {
  source: ListingText;
  /** The locale the seller wrote `source` in, and the one they want it in. */
  from: string;
  to: string;
}

let providerOverride: ModelProvider | null = null;
export function setDraftProviderForTests(p: ModelProvider | null) {
  providerOverride = p;
}

function draftProvider(source: ListingText): ModelProvider {
  if (providerOverride) return providerOverride;
  if (fakesRequested(env())) return untranslatedDraft(source);
  if (!env().ANTHROPIC_API_KEY) throw new DraftError("drafting a translation needs a model");
  // Shorter than the assistant's budget on purpose: two fields of a listing is
  // not a question with documents behind it.
  return new AnthropicProvider({ model: "claude-opus-5", effort: "low", maxTokens: 2_000 });
}

/**
 * The call and the parse, with no quota or trace around them. Split out the
 * way `assistantAgent` is, so the tests exercise the draft the route hands
 * back rather than a copy of it that drifts.
 *
 * One call: there are no tools to work through and nothing to look up, so a
 * reply that is not the two fields is a reply this prompt is not going to talk
 * into being them.
 */
export async function draftWith(provider: ModelProvider, { source, from, to }: DraftInput, tracer?: Tracer): Promise<ListingText> {
  const result = await runAgent({
    provider,
    system: draftSystem(from, to),
    input: draftInput(source),
    maxIterations: 1,
    ...(tracer ? { tracer, runName: `draft:${to}` } : {}),
  });
  const draft = parseDraft(result.text);
  if (!draft.ok) throw new DraftError(`no usable draft came back: ${draft.problem}`);
  return draft.value;
}

/**
 * The drafted translation for one seller, counted against the same monthly AI
 * budget a buyer's question is: it is the account's model call either way, and
 * a second counter would be a second thing to raise when an account runs out.
 * A draft that never arrived is refunded, for the reason a failed answer is —
 * nothing was delivered to charge for.
 */
export async function draftTranslation(user: User, input: DraftInput): Promise<ListingText> {
  const entitlements = await entitlementsForUser(user.id);
  const usage = await meter(user.id, "aiMessages", entitlements.quotas.aiMessages);
  if (!usage.allowed) throw new AssistantGateError(429, "monthly AI quota exceeded", usage);
  try {
    // Traced like a buyer's question, and for the same reason: what the model
    // cost this account is one table, whichever screen spent it.
    return await draftWith(draftProvider(input.source), input, new Tracer({ exporters: [new PrismaTraceExporter({ userId: user.id })] }));
  } catch (err) {
    await refundMeter(user.id, "aiMessages");
    throw err;
  }
}
