import type { APIRoute } from "astro";
import Stripe from "stripe";

let stripeInstance: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("MISSING_CONFIG: STRIPE_SECRET_KEY");
    stripeInstance = new Stripe(key, { apiVersion: "2026-02-25.clover" as Stripe.LatestApiVersion });
  }
  return stripeInstance;
}

export const GET: APIRoute = async ({ url }) => {
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "session_id required" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  let session;
  try {
    session = await getStripe().checkout.sessions.retrieve(sessionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "content-type": "application/json" } });
  }

  if (session.metadata?.flow !== "renewal") {
    return new Response(JSON.stringify({ error: "Not a renewal session" }), { status: 404, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({
    tier: session.metadata.tier,
    renewalYear: Number(session.metadata.renewal_year ?? 0),
    amountPaidCents: session.amount_total ?? 0,
  }), { status: 200, headers: { "content-type": "application/json" } });
};