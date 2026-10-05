/**
 * pnpm eval              extractive baseline, hash embedder — no keys, no database
 * EVAL_MODEL=1 pnpm eval the real assistant (ANTHROPIC_API_KEY, and VOYAGE_API_KEY for real embeddings)
 *
 * Prints every question, then the numbers that go in evals/README.md. The
 * search-relevance section at the end needs DATABASE_URL — Postgres is the
 * lexical arm — and says so rather than scoring zero without one.
 */
import { AnthropicProvider } from "agent-runtime/anthropic";
import { db } from "../src/lib/db.js";
import { pool } from "../src/lib/pg.js";
import { HashEmbedder, VoyageEmbedder } from "../src/rag/index.js";
import { runEval, type EvalReport, type RunOptions } from "./harness.js";
import { SCORED_ARMS, runSearchEval } from "./search.js";

const real = process.env.EVAL_MODEL === "1";
const voyageKey = process.env.VOYAGE_API_KEY;

const options: RunOptions = {
  ...(real ? { provider: () => new AnthropicProvider({ model: "claude-opus-5", effort: "medium", maxTokens: 4_000 }) } : {}),
  ...(voyageKey ? { embedder: new VoyageEmbedder(voyageKey) } : { embedder: new HashEmbedder() }),
  onResult: (r) => {
    const mark = r.correct ? "✓" : "✗";
    const recall = r.hit === null ? "—" : r.hit ? "hit" : "miss";
    console.log(`${mark} ${r.id.padEnd(11)} ${recall.padEnd(5)} ${r.question.question}`);
    if (!r.correct) console.log(`               ${r.failure}\n               got: ${oneLine(r.answer)}`);
  },
};

if (real && !process.env.ANTHROPIC_API_KEY) {
  console.error("EVAL_MODEL=1 needs ANTHROPIC_API_KEY");
  process.exit(1);
}

const report = await runEval(options);
console.log(`\nmodel     ${report.model}\nembedder  ${report.embedder}`);
const answerable = count(report, (r) => r.hit !== null);
console.log(`recall@5            ${pct(report.recallAt5)}  (${count(report, (r) => r.hit === true)}/${answerable})`);
console.log(`answer correctness  ${pct(report.answerCorrectness)}  (${count(report, (r) => r.hit !== null && r.correct)}/${answerable})`);
console.log(`invented nothing    ${pct(report.groundedness)}  (${count(report, (r) => r.hit === null && r.correct)}/6 unanswerable)`);
console.log(`refused outright    ${pct(report.refusalRate)}  (${count(report, (r) => r.hit === null && r.refused)}/6 unanswerable)`);

if (process.env.DATABASE_URL) {
  console.log("\nsearch relevance  20 queries over the same two documents");
  const search = await runSearchEval({ ...(options.embedder ? { embedder: options.embedder } : {}) });
  console.log("arm      recall    p@1     mrr  passage@1  body-only p@1");
  for (const arm of SCORED_ARMS) {
    const s = search.arms[arm];
    console.log(`${arm.padEnd(8)} ${pct(s.recall)} ${pct(s.precisionAt1)}  ${s.mrr.toFixed(3)}     ${pct(s.passageAt1)}         ${pct(s.bodyOnlyAt1)}`);
  }
  console.log(`\nqueries no document contains a word of, rejected by the lexical arm: ${pct(search.noiseRejected)}`);
  for (const c of search.cases.filter((r) => r.rank.hybrid !== 1)) {
    console.log(`✗ ${c.id.padEnd(20)} ${c.case.query} — expected ${c.case.slug}, hybrid ranked it ${c.rank.hybrid ?? "nowhere"}`);
  }
  await db.$disconnect();
  await pool().end();
} else {
  console.log("\nsearch relevance  skipped — needs DATABASE_URL (the lexical arm is Postgres)");
}

function pct(x: number) {
  return `${(x * 100).toFixed(1)}%`.padStart(6);
}
function count(report: EvalReport, predicate: (r: EvalReport["results"][number]) => boolean) {
  return report.results.filter(predicate).length;
}
function oneLine(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
}
