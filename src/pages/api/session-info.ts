import type { APIRoute } from "astro";
import Stripe from "stripe";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId) {
    return Response.json({ error: "Missing session_id." }, { status: 400 });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return Response.json({ error: "Server misconfiguration." }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items"],
    });

    return Response.json({
      plan: session.metadata?.plan ?? null,
      firstName: session.metadata?.first_name ?? null,
      lastName: session.metadata?.last_name ?? null,
      phone: session.metadata?.phone ?? null,
      email: session.customer_email ?? null,
      amount: session.amount_total ?? null,
      customerId:
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id ?? null,
    });
  } catch {
    return Response.json({ error: "Session not found." }, { status: 404 });
  }
};
