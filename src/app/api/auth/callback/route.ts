import { NextResponse } from "next/server";
import { issueSession } from "@/server/auth";
import { redeemSignInLink } from "@/server/magic-link";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * A GET, because it is a URL in an email and nothing else can be. Everything
 * that makes that safe is behind it: the link works once, for fifteen minutes,
 * and it grants only the role the account already had.
 *
 * Where it lands is never taken from the request. The locale comes off the
 * stored row, which can only hold a locale the request route validated, so
 * there is no redirect here for a crafted link to aim somewhere else.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await redeemSignInLink(token);
  if (!result.ok) {
    // Unprefixed, so next-intl's middleware picks the language of whoever clicked.
    return NextResponse.redirect(new URL(`/login?error=${result.reason}`, env().APP_URL), 303);
  }
  const response = NextResponse.redirect(new URL(`/${result.locale}`, env().APP_URL), 303);
  const cookie = await issueSession(result.user.id);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
