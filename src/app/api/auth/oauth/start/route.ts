import { NextResponse } from "next/server";
import { oauthProvider, startFlow } from "@/server/oauth";
import { isProviderName } from "@/domain/oauth";
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
 *
 * Which door is asked for in the query, and is a name matched against the ones
 * configured here: a provider is picked by it, so an unrecognised name is the
 * 404 a marketplace with no doors at all gives, rather than a redirect
 * assembled from whatever was typed.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const asked = query.get("provider");
  const provider = isProviderName(asked) ? oauthProvider(asked) : null;
  if (!provider) return new Response(null, { status: 404 });

  const locale = query.get("locale");
  const started = startFlow(provider, isLocale(locale) ? locale : defaultLocale, env().SESSION_SECRET);
  const response = NextResponse.redirect(started.url, 303);
  response.cookies.set(started.cookie.name, started.cookie.value, started.cookie.options);
  return response;
}
