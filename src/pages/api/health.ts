import type { APIRoute } from "astro";
import { logger } from "../../lib/logger";
import { getPaymentProvider, type PaymentProvider } from "../../lib/payments";
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
  provider: PaymentProvider | null,
  providerError: string | undefined,
  tierSlug: string,
): Promise<RenewalTierResult> {
  if (!provider) return { ok: false, error: providerError ?? "Payment provider unavailable" };
  try {
    const price = await provider.resolvePrice(tierSlug, "renewal");
    return {
      ok: true,
      priceId: price.priceRef,
      currency: price.currency,
      unitAmount: price.unitAmount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

async function checkPayment(
  provider: PaymentProvider | null,
  providerError: string | undefined,
): Promise<SubsystemResult> {
  if (!provider) return { status: "not_configured", error: providerError };
  return provider.healthCheck();
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
  // An invalid PAYMENT_PROVIDER must degrade the report, not crash the
  // endpoint that backs the Fly liveness check.
  let provider: PaymentProvider | null = null;
  let providerError: string | undefined;
  try {
    provider = getPaymentProvider();
  } catch (err) {
    providerError = err instanceof Error ? err.message : String(err);
  }

  // Phase M: iterate TIERS — N-tier ready. Each tier contributes one entry
  // to renewal_prices, keyed by tier slug.
  const renewalEntries = await Promise.all(
    listTiers().map(async (tier) => {
      const result = await safeResolveRenewalPrice(provider, providerError, tier.slug);
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

  const [payment, email] = await Promise.all([checkPayment(provider, providerError), checkMailgun()]);
  // When the provider can't be resolved, echo what was configured so the
  // alert says which provider is broken.
  const providerId =
    provider?.id ?? (process.env.PAYMENT_PROVIDER?.trim().toLowerCase() || "stripe");
  // `stripe` / `errors.stripe` are deprecated aliases kept for one release so
  // an already-deployed alert worker keeps working; they only describe Stripe.
  const stripeAlias = providerId === "stripe";

  if (payment.status === "disconnected") {
    logger.error("health.stripe_check_failed", { error: payment.error });
  }
  if (payment.status === "not_configured") {
    logger.warn("health.check", {
      reason: providerError ?? "STRIPE_SECRET_KEY not configured",
    });
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
    payment.status === "connected" &&
    email.status === "connected" &&
    allRenewalsOk;
  const body: Record<string, unknown> = {
    status: healthy ? "ok" : "degraded",
    payment: {
      provider: providerId,
      status: payment.status,
      ...(payment.error ? { error: payment.error } : {}),
    },
    ...(stripeAlias ? { stripe: payment.status } : {}),
    email: email.status,
    renewal_prices: renewalPrices,
  };
  if (payment.error || email.error || !allRenewalsOk) {
    body.errors = {
      ...(payment.error ? { payment: payment.error } : {}),
      ...(payment.error && stripeAlias ? { stripe: payment.error } : {}),
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
