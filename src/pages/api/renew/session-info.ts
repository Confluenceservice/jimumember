import type { APIRoute } from "astro";
import { getPaymentProvider } from "../../../lib/payments";

export const GET: APIRoute = async ({ url }) => {
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "session_id required" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  let checkout;
  try {
    checkout = await getPaymentProvider().getCheckout(sessionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "content-type": "application/json" } });
  }

  if (checkout.metadata.flow !== "renewal") {
    return new Response(JSON.stringify({ error: "Not a renewal session" }), { status: 404, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({
    tier: checkout.metadata.tier,
    renewalYear: Number(checkout.metadata.renewal_year ?? 0),
    amountPaidCents: checkout.amountTotal ?? 0,
  }), { status: 200, headers: { "content-type": "application/json" } });
};
