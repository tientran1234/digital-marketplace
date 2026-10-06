/**
 * The rows a thread lives in: read before the model is called, written once it
 * has answered.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ThreadTurn } from "@/domain/conversation";

/** This person's thread with this listing, oldest turn first. */
export async function threadFor(userId: string | null, productId: string): Promise<ThreadTurn[]> {
  if (!userId) return [];
  const thread = await db.thread.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { turns: { orderBy: { ordinal: "asc" }, select: { question: true, answer: true } } },
  });
  return thread?.turns ?? [];
}

/**
 * Add the exchange that just happened.
 *
 * The ordinal comes out of the thread's own counter rather than from a
 * `MAX(ordinal)` this transaction read: the increment takes the row's lock, so
 * a buyer with two tabs open takes two numbers instead of one of them failing
 * on the unique constraint after the model has already answered.
 */
export async function recordTurn(input: { userId: string; productId: string; turn: ThreadTurn }): Promise<void> {
  const threadId = await ensureThread(input.userId, input.productId);
  await db.$transaction(async (tx) => {
    const { turnCount } = await tx.thread.update({
      where: { id: threadId },
      data: { turnCount: { increment: 1 } },
      select: { turnCount: true },
    });
    await tx.threadTurn.create({ data: { threadId, ordinal: turnCount - 1, question: input.turn.question, answer: input.turn.answer } });
  });
}

/** An upsert can lose the race its own unique constraint is there to catch; the loser reads the winner's row. */
async function ensureThread(userId: string, productId: string): Promise<string> {
  const key = { userId_productId: { userId, productId } };
  try {
    return (await db.thread.upsert({ where: key, create: { userId, productId }, update: {} })).id;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    return (await db.thread.findUniqueOrThrow({ where: key })).id;
  }
}
