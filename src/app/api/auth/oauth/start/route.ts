import { NextResponse } from "next/server";
import { oauthProvider, startFlow } from "@/server/oauth";
import { env } from "@/lib/env";
import { defaultLocale, isLocale } from "@/i18n";

export const runtime = "nodejs";

/**
 * A GET, because it is a link on the sign-in page and what it goes to is a
 * redirect. Nothing is signed in here and nothing is written down: the whole
 * of it is a ten-minute cookie holding a random string and a PKCE secret.
 *
 * The locale is validated rather than carried, because it is what the callback
 * redirects to — a locale off a request would be an open redirect laundered
 * through a cookie we signed ourselves.
 */
export async function GET(request: Request) {
  const provider = oauthProvider();
  if (!provider) return new Response(null, { status: 404 });

  const asked = new URL(request.url).searchParams.get("locale");
  const started = startFlow(provider, isLocale(asked) ? asked : defaultLocale, env().SESSION_SECRET);
  const response = NextResponse.redirect(started.url, 303);
  response.cookies.set(started.cookie.name, started.cookie.value, started.cookie.options);
  return response;
}
