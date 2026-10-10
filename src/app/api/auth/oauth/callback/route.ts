import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { issueSession } from "@/server/auth";
import { FLOW_COOKIE, completeFlow, oauthProvider } from "@/server/oauth";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Where it lands is never taken from the request, the same as the sign-in
 * link's callback: the locale comes off the signed flow cookie, which can only
 * hold a locale the start route validated, so there is no redirect here for a
 * crafted callback to aim somewhere else.
 *
 * The flow cookie is cleared whichever way it went. Leaving a spent one is a
 * second usable state, and a flow that failed is one a buyer is about to
 * start again.
 */
export async function GET(request: Request) {
  const provider = oauthProvider();
  if (!provider) return new Response(null, { status: 404 });

  const query = new URL(request.url).searchParams;
  const result = await completeFlow(
    provider,
    { code: query.get("code") ?? "", state: query.get("state") ?? "", error: query.get("error") ?? undefined },
    (await cookies()).get(FLOW_COOKIE)?.value,
    env().SESSION_SECRET,
  );

  if (!result.ok) {
    // An unverified address is the one failure worth telling apart: it is the
    // only one a buyer cannot fix by pressing the button again, and saying so
    // lists nobody, unlike the sign-in link's single message.
    const error = result.reason === "unverified" ? "oauth_unverified" : "oauth";
    // Unprefixed, so next-intl's middleware picks the language of whoever clicked.
    const failed = NextResponse.redirect(new URL(`/login?error=${error}`, env().APP_URL), 303);
    failed.cookies.delete(FLOW_COOKIE);
    return failed;
  }

  const response = NextResponse.redirect(new URL(`/${result.locale}`, env().APP_URL), 303);
  const session = await issueSession(result.user.id);
  response.cookies.set(session.name, session.value, session.options);
  response.cookies.delete(FLOW_COOKIE);
  return response;
}
