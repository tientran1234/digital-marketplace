/**
 * The window a follow-up question is asked inside: what it carries, what it
 * drops, and what it says in place of what it dropped.
 */
import { describe, expect, it } from "vitest";
import { textOf, type ChatMessage } from "agent-runtime";
import { SUMMARY_MAX_LINES, THREAD_BUDGET_TOKENS, threadMemory, type ThreadTurn } from "@/domain/conversation";

const turn = (n: number): ThreadTurn => ({ question: `question ${n}`, answer: `answer ${n}` });
const texts = (window: readonly ChatMessage[]) => window.map((m) => textOf(m.content as never));
const asking = (text: string): ChatMessage => ({ role: "user", content: [{ type: "text", text }] });

/** Three of these turns do not fit, so something has to be folded. */
const tight = 30;

describe("thread memory", () => {
  it("opens on nothing when nothing has been asked yet", async () => {
    expect(await threadMemory([]).window()).toEqual([]);
  });

  it("carries the whole thread while it fits, oldest turn first", async () => {
    const memory = threadMemory([turn(1), turn(2)]);
    memory.append(asking("question 3"));

    expect(texts(await memory.window())).toEqual(["question 1", "answer 1", "question 2", "answer 2", "question 3"]);
  });

  it("drops the oldest turns and keeps the questions out of them", async () => {
    const window = await threadMemory([turn(1), turn(2), turn(3)], tight).window();

    expect(window[0]).toMatchObject({ role: "user" });
    expect(texts(window)[0]).toContain("- question 1");
    expect(texts(window).slice(1)).toEqual(["question 3", "answer 3"]);
    // The answers went: they came out of a document search_docs can read again.
    expect(texts(window).join("\n")).not.toContain("answer 1");
  });

  it("never sends a question without the answer it earned", async () => {
    for (const budget of [1, 10, 20, 30, 50, 90]) {
      const window = texts(await threadMemory([turn(1), turn(2), turn(3)], budget).window());
      for (const n of [1, 2, 3]) {
        expect(window.includes(`question ${n}`), `budget ${budget}`).toBe(window.includes(`answer ${n}`));
      }
    }
  });

  it("says the same thing once however many model calls a run makes", async () => {
    const memory = threadMemory([turn(1), turn(2), turn(3)], tight);
    await memory.window();
    const again = texts(await memory.window())[0]!;

    // Every call re-drops the same turns, so a fold that ran again would have
    // the model read one question as two.
    expect(again.match(/- question 1/g)).toHaveLength(1);
  });

  it("keeps the fold to its most recent questions, so one window cannot grow out of another", async () => {
    const turns = Array.from({ length: SUMMARY_MAX_LINES + 10 }, (_, i) => turn(i));
    const lines = texts(await threadMemory(turns, tight).window())[0]!.split("\n").slice(1);

    expect(lines).toHaveLength(SUMMARY_MAX_LINES);
    expect(lines.at(-1)).toBe(`- question ${turns.length - 2}`);
    expect(lines).not.toContain("- question 0");
  });

  it("clips a question that arrived as an essay", async () => {
    const window = await threadMemory([{ question: "why ".repeat(200), answer: "because" }, turn(2), turn(3)], tight).window();
    const line = texts(window)[0]!.split("\n")[1]!;

    expect(line.endsWith("…")).toBe(true);
    expect(line.length).toBeLessThan(200);
  });

  it("budgets the history alone, so a dozen exchanges are still in the window whole", async () => {
    const turns = Array.from({ length: 12 }, (_, i) => ({ question: `q${i} `.repeat(10), answer: `a${i} `.repeat(60) }));
    expect(await threadMemory(turns, THREAD_BUDGET_TOKENS).window()).toHaveLength(turns.length * 2);
  });
});
