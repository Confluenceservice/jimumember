import type { APIRoute } from "astro";
import { getPaymentProvider } from "../../lib/payments";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId) {
    return Response.json({ error: "Missing session_id." }, { status: 400 });
  }

  const provider = getPaymentProvider();
  if (provider.missingConfig("api").length > 0) {
    return Response.json({ error: "Server misconfiguration." }, { status: 500 });
  }

  try {
    const checkout = await provider.getCheckout(sessionId);

    return Response.json({
      plan: checkout.metadata.plan ?? null,
      firstName: checkout.metadata.first_name ?? null,
      lastName: checkout.metadata.last_name ?? null,
      phone: checkout.metadata.phone ?? null,
      email: checkout.customerEmail,
      amount: checkout.amountTotal,
      customerId: checkout.customerRef,
    });
  } catch {
    return Response.json({ error: "Session not found." }, { status: 404 });
  }
};
