import { z } from "zod";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { startPayoutOnboarding } from "@/server/payouts";

export const runtime = "nodejs";
const Body = z.object({ locale: z.string().min(2).max(5) });

/**
 * Open the provider's onboarding for this seller's payout account, creating the
 * account on the first click. The locale comes from the page so the seller lands
 * back in the language they left.
 */
export const POST = handle(async (request) => {
  const user = await requireUser(["SELLER", "ADMIN"]);
  const { locale } = await json(request, Body);
  return Response.json({ url: await startPayoutOnboarding(user, locale) });
});
