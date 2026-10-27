import type { APIRoute } from "astro";
import { appendRenewal, type PdEntry } from "../../../../lib/renewal-sheet";
import {
  getSiteBaseUrl,
  isCheckoutDryRunEnabled,
} from "../../../../lib/membership-terms";
import { CHECKOUT_REF_PLACEHOLDER, getPaymentProvider } from "../../../../lib/payments";
import { validateTier } from "../../../../lib/forms/runtime";
import { getTier } from "../../../../lib/forms/tiers";

function coercePdEntries(raw: unknown): PdEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PdEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (
      typeof o.dateCompleted !== "string" ||
      typeof o.activity !== "string" ||
      typeof o.totalHours !== "number" ||
      typeof o.provider !== "string"
    ) continue;
    out.push({
      dateCompleted: o.dateCompleted,
      activity: o.activity,
      totalHours: o.totalHours,
      provider: o.provider,
    });
  }
  return out;
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

  const provider = getPaymentProvider();

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
  const phone = String(values.phone ?? "").trim();
  const year = Number(values.year);
  const pdEntries = coercePdEntries(values.pdEntries);

  // Phase K: tier is config-sourced (plan finding C3: sheet + metadata must
  // match). RenewalInput.tier widened from "pm"|"am" to string, so the cast
  // is gone — storageValue is already a string.
  const tier = tierConfig.storageValue;

  let priceConfig;
  try {
    priceConfig = await provider.resolvePrice(tierSlug, "renewal");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("MISSING_CONFIG")) return serverError("MISSING_CONFIG", msg);
    if (msg.includes("PRICE_INACTIVE")) return serverError("PRICE_INACTIVE", msg);
    return serverError("CHECKOUT_ERROR", msg);
  }

  const renewalId = crypto.randomUUID();

  if (isCheckoutDryRunEnabled()) {
    return new Response(JSON.stringify({
      dryRun: true, priceValidated: true, priceId: priceConfig.priceRef, renewalId,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  const siteBaseUrl = getSiteBaseUrl(request.url);
  const createdAt = new Date().toISOString();

  try {
    await appendRenewal({
      renewalId, tier, year, firstName, lastName, email, phone,
      pdEntries, amountCents: priceConfig.unitAmount, currency: priceConfig.currency,
      paymentRef: "", paymentStatus: "pending", createdAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return serverError("SHEET_WRITE_FAILED", `Failed to write renewal row: ${msg}`, true);
  }

  let checkout;
  try {
    checkout = await provider.createCheckout({
      mode: "one_time",
      lineItem: { kind: "price", priceRef: priceConfig.priceRef },
      customerEmail: email,
      clientReference: renewalId,
      // NOTE: pdEntries are intentionally NOT placed in provider metadata — a
      // member with several PD rows would exceed Stripe's 500-char per-value
      // limit and the session create would throw. They are persisted in the
      // Renewals sheet by appendRenewal() above; the webhook reads them back
      // via getRenewalById(renewalId).
      metadata: {
        flow: "renewal", tier, renewal_id: renewalId, renewal_year: String(year),
        first_name: firstName, last_name: lastName, email, phone,
        amount_cents: String(priceConfig.unitAmount),
      },
      successUrl: `${siteBaseUrl}/renew/success?session_id=${CHECKOUT_REF_PLACEHOLDER}`,
      cancelUrl: `${siteBaseUrl}/renew/${tierSlug}?year=${year}&firstName=${encodeURIComponent(firstName)}&lastName=${encodeURIComponent(lastName)}&email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone)}`,
      idempotencyKey: `renewal:${tier}:${renewalId}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return serverError("CHECKOUT_ERROR", msg, provider.isRetryableError(err));
  }

  return new Response(JSON.stringify({ url: checkout.redirectUrl, renewalId }), {
    status: 200, headers: { "content-type": "application/json" },
  });
};
