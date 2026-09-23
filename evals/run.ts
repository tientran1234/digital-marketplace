/**
 * pnpm eval              extractive baseline, hash embedder — no keys, no database
 * EVAL_MODEL=1 pnpm eval the real assistant (ANTHROPIC_API_KEY, and VOYAGE_API_KEY for real embeddings)
 *
 * Prints every question, then the two numbers that go in evals/README.md.
 */
import { AnthropicProvider } from "agent-runtime/anthropic";
import { HashEmbedder, VoyageEmbedder } from "../src/rag/index.js";
import { runEval, type EvalReport, type RunOptions } from "./harness.js";

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
