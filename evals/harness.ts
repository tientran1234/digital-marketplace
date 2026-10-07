/**
 * Runs the question set against the assistant and scores two numbers:
 * recall@5 (did retrieval surface the passage that holds the answer) and
 * answer correctness (did the reply carry the fact it was supposed to carry).
 *
 * Everything except the model is the real pipeline — the same chunker,
 * embedder, MMR re-ranking, citation numbering, prompt and tools the ask box
 * runs. Only the candidate source is swapped: an in-memory scan instead of
 * pgvector, so the suite needs no database and the SQL stays covered by the
 * integration test.
 */
import { runAgent, type ModelProvider } from "agent-runtime";
import { extractiveBaseline } from "../src/providers/fake.js";
import { HashEmbedder, chunkDocument, cosine, retrieve, type ChunkSearch, type Embedder, type StoredChunk } from "../src/rag/index.js";
import { assistantAgent } from "../src/server/assistant.js";
import { seedDocs } from "../scripts/seed-docs.js";
import { answerable, questions, type EvalQuestion } from "./questions.js";

/** Passages retrieved per question — the 5 of recall@5, and what the agent sees. */
export const K = 5;

/** Phrasings that count as "the documents do not say". */
const REFUSAL = /\b(do(?:es)?n'?t|do not|does not|no|not|nothing|cannot|can'?t|unable)\b[^.]{0,60}\b(cover|covers|covered|says?|mentions?|mentioned|contains?|includes?|addresse?s?|discusse?s?|answers?|information|passages?|documents?)\b/i;

/** Chunk and embed the seed documents once; serve nearest neighbours from an array. */
export async function memoryIndex(embedder: Embedder): Promise<ChunkSearch> {
  const bySlug = new Map<string, StoredChunk[]>();
  for (const doc of seedDocs) {
    const chunks = chunkDocument(doc.text);
    const vectors = await embedder.embed(chunks.map((c) => c.content), "document");
    bySlug.set(doc.slug, chunks.map((c, i) => ({ id: `${doc.slug}:${c.ordinal}`, ordinal: c.ordinal, heading: c.heading, content: c.content, vector: vectors[i]!, score: 0 })));
  }
  return async (productId, query, limit) =>
    (bySlug.get(productId) ?? [])
      .map((c) => ({ ...c, score: cosine(query, c.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
}

export interface QuestionResult {
  id: string;
  question: EvalQuestion;
  /** Headings of the top-k passages, in the order MMR picked them. */
  retrieved: (string | null)[];
  /** Null for the six questions the corpus cannot answer: there is nothing to recall. */
  hit: boolean | null;
  answer: string;
  /** The answer says the documents do not cover it. */
  refused: boolean;
  /** Carried the expected fact; for an unanswerable question, invented nothing. */
  correct: boolean;
  /** Empty when correct; otherwise what was wrong. */
  failure: string;
}

export interface EvalReport {
  model: string;
  embedder: string;
  results: QuestionResult[];
  /** Of the 34 answerable questions: expected passages all in the top k. */
  recallAt5: number;
  /** Of the 34: the expected fact appears in the answer. */
  answerCorrectness: number;
  /** Of the 6 unanswerable: nothing invented. The baseline cannot fail this. */
  groundedness: number;
  /** Of the 6: said so rather than answering anyway. Zero for the baseline by design. */
  refusalRate: number;
}

export interface RunOptions {
  /** Defaults to the extractive baseline; `EVAL_MODEL=1` passes the real provider. */
  provider?: (question: string) => ModelProvider;
  embedder?: Embedder;
  onResult?: (result: QuestionResult) => void;
}

export async function runEval(options: RunOptions = {}): Promise<EvalReport> {
  const embedder = options.embedder ?? new HashEmbedder();
  const search = await memoryIndex(embedder);
  const makeProvider = options.provider ?? extractiveBaseline;
  const results: QuestionResult[] = [];

  for (const q of questions) {
    // Retrieval is scored on the question as typed; the answer is scored on
    // whatever the agent's own search brought back. The two can disagree, and
    // the gap between them is the number worth reading.
    const passages = await retrieve(q.slug, q.question, embedder, { k: K, search });
    const run = await runAgent({
      provider: makeProvider(q.question),
      ...assistantAgent(listing(q), { embedder, search }),
      input: q.question,
    });
    const result = grade(q, run.text, passages.map((p) => p.heading));
    results.push(result);
    options.onResult?.(result);
  }

  const known = results.filter((r) => r.hit !== null);
  const unknown = results.filter((r) => r.hit === null);
  return {
    model: makeProvider("").model,
    embedder: embedder.model,
    results,
    recallAt5: ratio(known.filter((r) => r.hit).length, known.length),
    answerCorrectness: ratio(known.filter((r) => r.correct).length, known.length),
    groundedness: ratio(unknown.filter((r) => r.correct).length, unknown.length),
    refusalRate: ratio(unknown.filter((r) => r.refused).length, unknown.length),
  };
}

export function grade(q: EvalQuestion, answer: string, retrieved: (string | null)[]): QuestionResult {
  const invented = q.reject?.find((p) => p.test(answer));
  const refused = REFUSAL.test(answer);
  const missing = q.answer.find((p) => !p.test(answer));
  const base = { id: q.id, question: q, retrieved, answer, refused };

  if (!answerable(q)) return { ...base, hit: null, correct: !invented, failure: invented ? `invented: ${invented}` : "" };
  return {
    ...base,
    hit: q.passages.every((p) => retrieved.includes(p)),
    correct: !missing && !invented,
    failure: invented ? `invented: ${invented}` : missing ? `answer lacks ${missing}` : "",
  };
}

const ratio = (part: number, whole: number) => (whole ? part / whole : 0);

/**
 * The listing the agent sees. Ids are slugs here: the in-memory index is keyed
 * by them. The seed corpus is English and untranslated, so the agent grades on
 * the listing's own words — which is what it answers off for a buyer reading
 * in the language it was written in.
 */
function listing(q: EvalQuestion) {
  const doc = seedDocs.find((d) => d.slug === q.slug)!;
  return { id: doc.slug, title: doc.title, description: doc.description, locale: "en", priceMinor: doc.priceMinor, currency: "usd", status: "PUBLISHED" as const, seller: { name: "Linh (seller)" } };
}
