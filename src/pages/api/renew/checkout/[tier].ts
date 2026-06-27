import type { APIRoute } from "astro";
import Stripe from "stripe";
import { resolveRenewalPrice } from "../../../../lib/stripe-products";
import { appendRenewal } from "../../../../lib/renewal-sheet";
import {
  getSiteBaseUrl,
  isCheckoutDryRunEnabled,
  isStripeRetryableError,
} from "../../../../lib/stripe-checkout";
import { validateTier } from "../../../../lib/forms/runtime";
import { getTier } from "../../../../lib/forms/tiers";

/**
 * Tier → Stripe renewal lookup-key map. Hardcoded for B2 (Associate only);
 * Phase D derives this from TIERS + the renewal price env vars.
 */
const TIER_LOOKUP_KEY: Record<string, "am_renewal_nzd" | "pm_renewal_nzd"> = {
  associate: "am_renewal_nzd",
  professional: "pm_renewal_nzd",
};

let stripeInstance: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("MISSING_CONFIG: STRIPE_SECRET_KEY");
    stripeInstance = new Stripe(key, { apiVersion: "2026-02-25.clover" as Stripe.LatestApiVersion });
  }
  return stripeInstance;
}

function badRequest(field: string, message: string) {
  return new Response(JSON.stringify({ error: message, field }), { status: 400, headers: { "content-type": "application/json" } });
}

function serverError(code: string, message: string, retryable = false) {
  return new Response(JSON.stringify({ error: message, code, retryable }), { status: 500, headers: { "content-type": "application/json" } });
}

export const POST: APIRoute = async ({ request, params }) => {
  const tierSlug = params.tier;
  if (!tierSlug) return badRequest("tier", "Tier required");

  let tierConfig;
  try { tierConfig = getTier(tierSlug); }
  catch { return badRequest("tier", `Unknown tier: ${tierSlug}`); }

  const lookupKey = TIER_LOOKUP_KEY[tierSlug];
  if (!lookupKey) return badRequest("tier", `No Stripe renewal price mapped for tier: ${tierSlug}`);

  let body: unknown;
  try { body = await request.json(); }
  catch { return badRequest("body", "Invalid JSON"); }

  const result = await validateTier(tierSlug, body);
  if (!result.ok) {
    const [field, message] = Object.entries(result.errors)[0] ?? ["body", "Invalid input"];
    return badRequest(field, message);
  }

  const values = result.values as Record<string, unknown>;
  const firstName = String(values.firstName ?? "").trim();
  const lastName = String(values.lastName ?? "").trim();
  const email = String(values.email ?? "").trim();
  const year = Number(values.year);

  // tier is config-sourced (plan finding C3: sheet + metadata must match).
  // Cast to the legacy literal union — RenewalInput.tier is "pm" | "am";
  // storageValue is typed string for future flexibility.
  const tier = tierConfig.storageValue as "pm" | "am";

  let priceConfig;
  try {
    priceConfig = await resolveRenewalPrice(lookupKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("MISSING_CONFIG")) return serverError("MISSING_CONFIG", msg);
    if (msg.includes("PRICE_INACTIVE")) return serverError("PRICE_INACTIVE", msg);
    return serverError("CHECKOUT_ERROR", msg);
  }

  const renewalId = crypto.randomUUID();

  if (isCheckoutDryRunEnabled()) {
    return new Response(JSON.stringify({
      dryRun: true, priceValidated: true, priceId: priceConfig.priceId, renewalId,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  const siteBaseUrl = getSiteBaseUrl(request.url);
  const createdAt = new Date().toISOString();

  try {
    await appendRenewal({
      renewalId, tier, year, firstName, lastName, email, phone: "",
      pdEntries: [], amountCents: priceConfig.unitAmount, currency: priceConfig.currency,
      stripeSession: "", paymentStatus: "pending", createdAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return serverError("SHEET_WRITE_FAILED", `Failed to write renewal row: ${msg}`, true);
  }

  let session;
  try {
    session = await getStripe().checkout.sessions.create({
      mode: "payment",
      success_url: `${siteBaseUrl}/renew/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteBaseUrl}/renew/${tierSlug}?year=${year}&firstName=${encodeURIComponent(firstName)}&lastName=${encodeURIComponent(lastName)}&email=${encodeURIComponent(email)}`,
      line_items: [{ quantity: 1, price: priceConfig.priceId }],
      customer_email: email,
      customer_creation: "always",
      client_reference_id: renewalId,
      payment_intent_data: { receipt_email: email, setup_future_usage: "off_session" },
      metadata: {
        flow: "renewal", tier, renewal_id: renewalId, renewal_year: String(year),
        first_name: firstName, last_name: lastName, email, phone: "",
        pd_entries: "", amount_cents: String(priceConfig.unitAmount),
      },
    }, { idempotencyKey: `renewal:${tier}:${renewalId}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return serverError("CHECKOUT_ERROR", msg, isStripeRetryableError(err));
  }

  return new Response(JSON.stringify({ url: session.url, renewalId }), {
    status: 200, headers: { "content-type": "application/json" },
  });
};