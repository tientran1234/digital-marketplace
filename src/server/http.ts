import { ZodError } from "zod";
import { AuthError } from "./auth";
import { AssistantGateError } from "./assistant";

type Handler<C> = (request: Request, ctx: C) => Promise<Response>;

/** Map the errors our services throw on purpose to HTTP; let the rest surface as 500s. */
export function handle<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (request, ctx) => {
    try {
      return await fn(request, ctx);
    } catch (err) {
      if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
      if (err instanceof AssistantGateError) return Response.json({ error: err.message, detail: err.detail ?? null }, { status: err.status });
      if (err instanceof ZodError) return Response.json({ error: "invalid input", details: err.flatten() }, { status: 400 });
      throw err;
    }
  };
}

export async function json<T>(request: Request, schema: { parse(v: unknown): T }): Promise<T> {
  return schema.parse(await request.json().catch(() => null));
}

export type Params<K extends string> = { params: Promise<Record<K, string>> };
