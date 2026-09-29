import { z } from "zod";
import { handle, json } from "@/server/http";
import { requestSignInLink } from "@/server/magic-link";
import { defaultLocale, locales } from "@/i18n";

export const runtime = "nodejs";
const Body = z.object({ email: z.string().email(), locale: z.enum(locales).default(defaultLocale) });

/** 204 for every address, always: a different status for a known one would list our customers. */
export const POST = handle(async (request) => {
  const { email, locale } = await json(request, Body);
  await requestSignInLink(email.toLowerCase().trim(), locale);
  return new Response(null, { status: 204 });
});
