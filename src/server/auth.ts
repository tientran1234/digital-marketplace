import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Role, User } from "@prisma/client";
import { db } from "@/lib/db";
import { devLoginEnabled } from "@/lib/env";

const COOKIE = "dm_session";
const TTL_MS = 30 * 24 * 3600_000;

/**
 * Opaque server-side sessions: a random id in an httpOnly cookie, the row in
 * Postgres. Nothing to forge, revocation is a DELETE. Swap the login route for
 * Auth.js / Clerk / magic links without touching anything that reads sessions.
 */
export async function createSession(userId: string): Promise<void> {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.session.create({ data: { id, userId, expiresAt } });
  (await cookies()).set(COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: expiresAt, path: "/" });
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

/** Dev-only sign-in by email. Disabled in production unless ALLOW_DEV_LOGIN=1 (demo deployments). */
export async function devLogin(email: string, role: Role): Promise<User> {
  if (!devLoginEnabled()) throw new AuthError(403, "dev login is disabled");
  const user = await db.user.upsert({
    where: { email },
    create: { email, name: email.split("@")[0] ?? email, role },
    update: { role },
  });
  await createSession(user.id);
  return user;
}
