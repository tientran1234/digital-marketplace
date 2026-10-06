/**
 * A thread with one listing's assistant, and what becomes of the turns that no
 * longer fit the model's window. Pure, so the budget the ask box runs under is
 * the one the tests measure.
 */
import { ConversationMemory, type ChatMessage } from "agent-runtime";

/** One exchange: the question and the answer it earned. */
export interface ThreadTurn {
  question: string;
  answer: string;
}

/**
 * Tokens of conversation one model call may carry. It is a budget for the
 * history alone: the system prompt is outside it, and so are the passages
 * `search_docs` returns during the run, which are most of what a long answer
 * sends. Generous enough for a dozen exchanges, small enough that the thread
 * can never be the reason a call runs out of window.
 */
export const THREAD_BUDGET_TOKENS = 2_000;

/** Questions one fold keeps, newest first. A summary that grows forever is the window problem again, one level down. */
export const SUMMARY_MAX_LINES = 20;

/** Of a dropped question, which is a sentence rather than a document. */
const SUMMARY_LINE_CHARS = 120;

/**
 * The window the next question is asked inside: this thread, oldest turn
 * first, trimmed to the budget by `ConversationMemory` — which drops whole
 * turns, so no question is ever sent without its answer.
 *
 * What survives a drop is the questions, not the answers. A follow-up ("and in
 * euros?") needs to know what was asked; the answers came out of a document
 * `search_docs` can read again, which no summary of them would do better. And
 * a model call to write prose about prose would cost the buyer a message they
 * never asked for, and could fail in the middle of the one they did.
 *
 * Which is also why nothing is stored: the fold is a function of the turns, so
 * every call derives the same one from the same rows, the way an entitlement is
 * derived from a subscription rather than written down beside it.
 */
export function threadMemory(turns: readonly ThreadTurn[], maxTokens = THREAD_BUDGET_TOKENS): ConversationMemory {
  const folded = new Set<ChatMessage>();
  const memory = new ConversationMemory({
    maxTokens,
    summarize: (dropped) => {
      const fresh = dropped.filter((m) => !folded.has(m));
      for (const m of dropped) folded.add(m);
      // Every model call of a run re-drops the same turns, so by the second one
      // there is nothing left to fold — and folding them again would have the
      // model read one question as two.
      return questionsOf(fresh)
        .slice(-SUMMARY_MAX_LINES)
        .map((question) => `- ${clip(question)}`)
        .join("\n");
    },
  });

  for (const turn of turns) {
    memory.append(asked(turn.question));
    memory.append(answered(turn.answer));
  }
  return memory;
}

const asked = (text: string): ChatMessage => ({ role: "user", content: [{ type: "text", text }] });
const answered = (text: string): ChatMessage => ({ role: "assistant", content: [{ type: "text", text }] });

/** What the person asked. Tool results are user messages too, but they are the document speaking, not them. */
function questionsOf(messages: readonly ChatMessage[]): string[] {
  const questions: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of message.content) if (part.type === "text") questions.push(part.text);
  }
  return questions;
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > SUMMARY_LINE_CHARS ? `${line.slice(0, SUMMARY_LINE_CHARS - 1)}…` : line;
}
