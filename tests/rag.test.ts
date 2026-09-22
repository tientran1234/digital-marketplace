import { describe, expect, it } from "vitest";
import { HashEmbedder, chunkDocument, cosine, mmr } from "@/rag";

const doc = `# Pricing

## Plans
We offer three plans. The middle plan is the default. The top plan makes the middle look reasonable.

## Refunds
Refunds are granted within 14 days. No questions asked. Track the reason codes.

Second paragraph of the refunds section. It has more sentences. Each one is short. There are several of them. Enough to force a split when the target is tiny.`;

describe("chunkDocument", () => {
  it("keeps the section heading on every chunk cut from it", () => {
    const chunks = chunkDocument(doc, { targetTokens: 20, overlapSentences: 1 });
    const refundChunks = chunks.filter((c) => c.heading === "Refunds");
    expect(refundChunks.length).toBeGreaterThan(1);
    for (const c of refundChunks) expect(c.content.startsWith("Refunds\n")).toBe(true);
  });

  it("overlaps consecutive chunks so a boundary does not lose a sentence", () => {
    const chunks = chunkDocument(doc, { targetTokens: 20, overlapSentences: 1 });
    const refund = chunks.filter((c) => c.heading === "Refunds");
    const lastSentenceOfFirst = refund[0]!.content.split(". ").at(-1)!.replace(/\.$/, "");
    expect(refund[1]!.content).toContain(lastSentenceOfFirst.slice(0, 12));
  });

  it("numbers chunks in document order and sizes them under the target", () => {
    const chunks = chunkDocument(doc, { targetTokens: 40 });
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(40 + 20); // heading + one sentence of slack
  });

  it("returns nothing for an empty document", () => {
    expect(chunkDocument("   \n\n ")).toEqual([]);
  });
});

describe("HashEmbedder", () => {
  it("is deterministic, unit-length, and scores shared vocabulary higher", async () => {
    const e = new HashEmbedder();
    const [a, a2, b] = await e.embed(["refund window fourteen days", "refund window fourteen days", "notion weekly review"], "document");
    expect(a).toEqual(a2);
    expect(Math.hypot(...a!)).toBeCloseTo(1, 6);
    expect(cosine(a!, a2!)).toBeCloseTo(1, 6);
    expect(cosine(a!, b!)).toBeLessThan(0.2);
  });
});

describe("mmr", () => {
  it("prefers a diverse second pick over a near-duplicate of the first", async () => {
    const e = new HashEmbedder();
    const texts = ["refund policy fourteen days", "refund policy fourteen days no questions", "annual billing discount fifteen percent"];
    const [q, ...vs] = await e.embed(["refund policy", ...texts], "query");
    const candidates = texts.map((t, i) => ({ item: t, vector: vs[i]!, score: cosine(q!, vs[i]!) }));

    const byScore = [...candidates].sort((x, y) => y.score - x.score).slice(0, 2).map((c) => c.item);
    expect(byScore.every((t) => t.startsWith("refund"))).toBe(true); // top-2 by similarity: two refund chunks

    const picked = mmr(q!, candidates, 2, 0.5).map((c) => c.item);
    expect(picked[0]).toMatch(/^refund/);
    expect(picked[1]).toBe("annual billing discount fifteen percent"); // MMR: the other topic
  });

  it("returns at most k and never repeats", () => {
    const cands = [1, 2, 3].map((n) => ({ item: n, vector: [n, 1], score: 1 / n }));
    const out = mmr([1, 1], cands, 5);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((c) => c.item)).size).toBe(3);
  });
});
