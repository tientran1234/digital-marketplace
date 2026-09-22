import { WebhookVerificationError } from "@/domain/billing-event";
import { applyEvent } from "@/server/billing";
import { billingProvider } from "@/server/provider";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature") ?? "";
  const rawBody = await request.text(); // raw bytes — request.json() would break the signature
  const provider = billingProvider();
  let event;
  try {
    event = await provider.verifyWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof WebhookVerificationError) return Response.json({ error: "invalid signature" }, { status: 400 });
    throw err;
  }
  const outcome = await applyEvent(provider.name, event);
  return Response.json({ received: true, outcome }); // always 200 once verified: every outcome is final
}
