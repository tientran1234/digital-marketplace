import { z } from "zod";
import { devLogin } from "@/server/auth";
import { handle, json } from "@/server/http";

export const runtime = "nodejs";
const Body = z.object({ email: z.string().email(), role: z.enum(["BUYER", "SELLER", "ADMIN"]).default("BUYER") });

export const POST = handle(async (request) => {
  const { email, role } = await json(request, Body);
  const user = await devLogin(email, role);
  return Response.json({ id: user.id, email: user.email, role: user.role });
});
