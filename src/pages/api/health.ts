import type { APIRoute } from "astro";
import Stripe from "stripe";
import { logger } from "../../lib/logger";

export const GET: APIRoute = async () => {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!secretKey) {
    logger.warn("health.check", { reason: "STRIPE_SECRET_KEY not configured" });
    return Response.json(
      { status: "degraded", stripe: "not_configured" },
      { status: 503 },
    );
  }

  try {
    const stripe = new Stripe(secretKey);
    // Simple API call that proves the key is valid
    await stripe.products.list({ limit: 1 });
    return Response.json({ status: "ok", stripe: "connected" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("health.stripe_check_failed", { error: message });
    return Response.json(
      { status: "degraded", stripe: "disconnected", error: message },
      { status: 503 },
    );
  }
};
