import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Role, User } from "@prisma/client";
import { db } from "@/lib/db";

const COOKIE = "dm_session";
const TTL_MS = 30 * 24 * 3600_000;

export type SessionCookie = {
  name: string;
  value: string;
  options: { httpOnly: true; sameSite: "lax"; secure: boolean; expires: Date; path: string };
};

/**
 * Opaque server-side sessions: a random id in an httpOnly cookie, the row in
 * Postgres. Nothing to forge, revocation is a DELETE.
 *
 * The cookie is handed back rather than written here, because the one caller
 * is a redirect that has to carry it on the same response it redirects with.
 */
export async function issueSession(userId: string): Promise<SessionCookie> {
  const value = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.session.create({ data: { id: value, userId, expiresAt } });
  return {
    name: COOKIE,
    value,
    options: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: expiresAt, path: "/" },
  };
}

export async function getCurrentUser(): Promise<User | null> {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id) return null;
  const session = await db.session.findUnique({ where: { id }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export class AuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function requireUser(roles?: Role[]): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, "sign in first");
  if (roles && !roles.includes(user.role)) throw new AuthError(403, `requires role ${roles.join(" or ")}`);
  return user;
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) await db.session.deleteMany({ where: { id } });
  jar.delete(COOKIE);
}
