import type { APIRoute } from "astro";
import Stripe from "stripe";
import { logger } from "../../lib/logger";
import { resolveRenewalPrice } from "../../lib/stripe-products";
import { listTiers } from "../../lib/forms/tiers";

type SubsystemStatus = "connected" | "disconnected" | "not_configured";

interface SubsystemResult {
  status: SubsystemStatus;
  error?: string;
}

type RenewalTierResult =
  | { ok: true; priceId: string; currency: string; unitAmount: number }
  | { ok: false; error: string };

async function safeResolveRenewalPrice(
  key: `${string}_renewal_nzd`,
): Promise<RenewalTierResult> {
  try {
    const price = await resolveRenewalPrice(key);
    return {
      ok: true,
      priceId: price.priceId,
      currency: price.currency,
      unitAmount: price.unitAmount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

async function checkStripe(): Promise<SubsystemResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return { status: "not_configured" };

  try {
    const stripe = new Stripe(secretKey);
    await stripe.products.list({ limit: 1 });
    return { status: "connected" };
  } catch (err) {
    return {
      status: "disconnected",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Verifies Mailgun is configured. We intentionally do NOT make a network
// call here: domain-level API keys (the recommended least-privilege scope)
// return 404 on GET /v3/{domain} even though they can POST to /messages.
// Env presence is the strongest signal we can get without a key-scope
// roundtrip. If a real send fails, the email-sender's error path logs it
// to the audit sheet and the Fly logger.
async function checkMailgun(): Promise<SubsystemResult> {
  const apiKey = process.env.MAILGUN_API_KEY?.trim();
  const domain = process.env.MAILGUN_DOMAIN?.trim();
  const from = process.env.MAILGUN_FROM?.trim();

  if (!apiKey || !domain || !from) {
    return { status: "not_configured" };
  }

  return { status: "connected" };
}

export const GET: APIRoute = async () => {
  // Phase M: iterate TIERS — N-tier ready. Each tier contributes one entry
  // to renewal_prices, keyed by tier slug.
  const renewalEntries = await Promise.all(
    listTiers().map(async (tier) => {
      const key = `${tier.storageValue}_renewal_nzd` as `${string}_renewal_nzd`;
      const result = await safeResolveRenewalPrice(key);
      if (!result.ok) {
        logger.error("health.renewal_price_check_failed", {
          tier: tier.slug,
          error: result.error,
        });
      }
      return [tier.slug, result] as const;
    }),
  );
  const renewalPrices = Object.fromEntries(renewalEntries);
  const allRenewalsOk = renewalEntries.every(([, r]) => r.ok);

  const [stripe, email] = await Promise.all([checkStripe(), checkMailgun()]);

  if (stripe.status === "disconnected") {
    logger.error("health.stripe_check_failed", { error: stripe.error });
  }
  if (stripe.status === "not_configured") {
    logger.warn("health.check", { reason: "STRIPE_SECRET_KEY not configured" });
  }
  if (email.status === "disconnected") {
    logger.error("health.mailgun_check_failed", { error: email.error });
  }
  if (email.status === "not_configured") {
    logger.warn("health.check", {
      reason: "MAILGUN_API_KEY or MAILGUN_DOMAIN not configured",
    });
  }

  // A subsystem is healthy only when fully connected. "not_configured" counts
  // as unhealthy: in deployed envs these credentials are mandatory, and a
  // silently missing key is exactly the failure this endpoint must catch.
  // Renewal price resolution is also required for the renew/ checkout endpoints
  // to function — a silently stale or missing price must surface as degraded
  // so the Slack health alerter fires.
  const healthy =
    stripe.status === "connected" &&
    email.status === "connected" &&
    allRenewalsOk;
  const body: Record<string, unknown> = {
    status: healthy ? "ok" : "degraded",
    stripe: stripe.status,
    email: email.status,
    renewal_prices: renewalPrices,
  };
  if (stripe.error || email.error || !allRenewalsOk) {
    body.errors = {
      ...(stripe.error ? { stripe: stripe.error } : {}),
      ...(email.error ? { email: email.error } : {}),
      ...renewalEntries
        .filter(([, r]) => !r.ok)
        .reduce<Record<string, string>>((acc, [slug, r]) => {
          acc[`renewal_prices.${slug}`] = (r as { ok: false; error: string }).error;
          return acc;
        }, {}),
    };
  }

  // Always 200: this path backs the Fly HTTP liveness check on a single-machine
  // app. Returning 503 here would make Fly pull the only VM out of rotation and
  // take the public site down when only a background subsystem (e.g. email) is
  // degraded. Consumers read `body.status` for readiness; the Slack worker
  // alerts whenever status !== "ok".
  return Response.json(body);
};
