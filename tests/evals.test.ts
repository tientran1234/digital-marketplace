/**
 * The assistant eval suite as a test: the question set has to stay grounded in
 * the seed documents, and retrieval + answers have to stay above the floors
 * recorded in evals/README.md. No database and no API key — the corpus is
 * chunked and searched in memory, and the model is the FakeProvider.
 */
import { describe, expect, it } from "vitest";
import { chunkDocument } from "@/rag";
import { seedDocs } from "../scripts/seed-docs";
import { answerable, questions } from "../evals/questions";

const headingsBySlug = new Map(seedDocs.map((d) => [d.slug, new Set(chunkDocument(d.text).map((c) => c.heading))]));

describe("eval question set", () => {
  it("asks forty questions, six of them unanswerable from the corpus", () => {
    expect(questions).toHaveLength(40);
    expect(questions.filter((q) => !answerable(q))).toHaveLength(6);
    expect(new Set(questions.map((q) => q.id)).size).toBe(40);
  });

  it("names a real product and real headings for every expected passage", () => {
    for (const q of questions) {
      const headings = headingsBySlug.get(q.slug);
      expect(headings, `${q.id}: unknown product ${q.slug}`).toBeDefined();
      for (const p of q.passages) expect(headings!.has(p), `${q.id}: no chunk headed "${p}"`).toBe(true);
    }
  });

  it("expects an answer exactly when the corpus contains one", () => {
    for (const q of questions) {
      expect(q.answer.length > 0, `${q.id}: answerable questions need expected answers`).toBe(answerable(q));
      if (!answerable(q)) expect(q.reject?.length, `${q.id}: unanswerable questions need reject patterns`).toBeGreaterThan(0);
    }
  });

  it("grounds every expected answer in the passage it points at", () => {
    for (const q of questions.filter(answerable)) {
      const doc = seedDocs.find((d) => d.slug === q.slug)!;
      const text = chunkDocument(doc.text).filter((c) => q.passages.includes(c.heading ?? "")).map((c) => c.content).join("\n");
      for (const pattern of q.answer) expect(pattern.test(text), `${q.id}: ${pattern} is not in ${q.passages.join(", ")}`).toBe(true);
    }
  });
});
