/**
 * The seam the end-to-end suite runs on: a server process started with
 * FAKE_PROVIDERS=1 answers checkout and the assistant from the doubles, and
 * the extractive stand-in answers only out of what retrieval handed it.
 */
import { describe, expect, it } from "vitest";
import { QUOTED, extractiveBaseline, fakesRequested } from "@/providers/fake";
import type { ChatMessage, ModelRequest, ToolUsePart } from "agent-runtime";

const request = (messages: ChatMessage[] = []): ModelRequest => ({ messages });
const toolResult = (content: string): ChatMessage => ({ role: "user", content: [{ type: "tool_result", toolUseId: "s1", content }] });
const textOf = (parts: { type: string }[]) => parts.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("");

describe("fakesRequested", () => {
  it("serves the doubles only when asked for by name", () => {
    expect(fakesRequested({})).toBe(false);
    expect(fakesRequested({ FAKE_PROVIDERS: "1" })).toBe(true);
    // Not a truthiness check: "0" and "false" are things people write to turn a flag off.
    for (const value of ["", "0", "false", "true", "yes"]) expect(fakesRequested({ FAKE_PROVIDERS: value })).toBe(false);
  });

  /**
   * The whole point of the flag is that it is set from outside the process, so
   * it can land in an environment that also has the real keys. Refusing is the
   * only answer that cannot pass while doing the wrong thing.
   */
  it("refuses to stand in front of a real credential", () => {
    expect(() => fakesRequested({ FAKE_PROVIDERS: "1", STRIPE_SECRET_KEY: "sk_live_x" })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => fakesRequested({ FAKE_PROVIDERS: "1", ANTHROPIC_API_KEY: "sk-ant-x" })).toThrow(/ANTHROPIC_API_KEY/);
    // Without the flag the keys are just the normal configuration.
    expect(fakesRequested({ STRIPE_SECRET_KEY: "sk_live_x", ANTHROPIC_API_KEY: "sk-ant-x" })).toBe(false);
  });
});

describe("extractive baseline", () => {
  it("searches once, for the question as asked", async () => {
    const provider = extractiveBaseline("how long is the refund window");
    const first = await provider.complete(request());
    expect(first.stopReason).toBe("tool_use");
    const call = first.content.find((p): p is ToolUsePart => p.type === "tool_use");
    expect(call).toMatchObject({ name: "search_docs", input: { query: "how long is the refund window" } });
  });

  it("quotes the passages back under their citation numbers, headings dropped", async () => {
    const provider = extractiveBaseline("q");
    await provider.complete(request());
    const answer = await provider.complete(request([toolResult("[1] (Refunds) Fourteen days.\n\n[2] (Billing) Annual gets fifteen percent.")]));
    expect(textOf(answer.content)).toBe("[1] Fourteen days. [2] Annual gets fifteen percent.");
    expect(answer.stopReason).toBe("end_turn");
  });

  it("stops at QUOTED passages, however many came back", async () => {
    const provider = extractiveBaseline("q");
    await provider.complete(request());
    const passages = Array.from({ length: QUOTED + 2 }, (_, i) => `[${i + 1}] passage ${i + 1}`).join("\n\n");
    expect(textOf((await provider.complete(request([toolResult(passages)]))).content)).toBe(
      Array.from({ length: QUOTED }, (_, i) => `[${i + 1}] passage ${i + 1}`).join(" "),
    );
  });

  /** It cannot invent: with nothing retrieved there is nothing for it to say. */
  it("has nothing to say when retrieval came back empty", async () => {
    const provider = extractiveBaseline("q");
    await provider.complete(request());
    expect(textOf((await provider.complete(request([toolResult("")]))).content)).toBe("");
  });
});
