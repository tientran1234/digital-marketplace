import { z } from "zod";

/** Parsed lazily so `next build` and unit tests run without secrets. */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  APP_URL: z.string().url().default("http://localhost:3000"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  LICENSE_TOKEN: z.string().optional(),
  LICENSE_PUBLIC_KEY: z.string().optional(),
  WORKFLOW_TICK_SECRET: z.string().optional(),
  ALLOW_DEV_LOGIN: z.string().optional(),
});

let cached: z.infer<typeof schema> | null = null;
export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || env().ALLOW_DEV_LOGIN === "1";
}
