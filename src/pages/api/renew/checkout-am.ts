import type { APIRoute } from "astro";
import Stripe from "stripe";
import { resolveRenewalPrice } from "../../../lib/stripe-products";
import { appendRenewal } from "../../../lib/renewal-sheet";
import { getSiteBaseUrl, isCheckoutDryRunEnabled, isStripeRetryableError } from "../../../lib/stripe-checkout";

const EMAIL_RE = /^[^\r\n@\s]+@[^\r\n@\s]+\.[^\r\n@\s]+$/;

interface CheckoutAmBody {
  firstName?: string;
  lastName?: string;
  email?: string;
  year?: number;
}

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

export const POST: APIRoute = async ({ request }) => {
  let body: CheckoutAmBody;
  try { body = (await request.json()) as CheckoutAmBody; }
  catch { return badRequest("body", "Invalid JSON"); }

  const firstName = (body.firstName ?? "").trim();
  const lastName = (body.lastName ?? "").trim();
  const email = (body.email ?? "").trim();
  const year = Number(body.year);

  if (!firstName) return badRequest("firstName", "First name required");
  if (!lastName) return badRequest("lastName", "Last name required");
  if (!EMAIL_RE.test(email)) return badRequest("email", "Valid email required");
  if (!Number.isInteger(year) || year < 2024 || year > 2100) return badRequest("year", "Valid year required");

  let priceConfig;
  try {
    priceConfig = await resolveRenewalPrice("am_renewal_nzd");
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
      renewalId, tier: "am", year, firstName, lastName, email, phone: "",
      pdEntries: [], amountCents: priceConfig.unitAmount, currency: priceConfig.currency,
      stripeSession: "", paymentStatus: "pending", createdAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return serverError("SHEET_WRITE_FAILED", `Failed to write renewal row: ${msg}`);
  }

  let session;
  try {
    session = await getStripe().checkout.sessions.create({
      mode: "payment",
      success_url: `${siteBaseUrl}/renew/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteBaseUrl}/renew/associate?year=${year}&firstName=${encodeURIComponent(firstName)}&lastName=${encodeURIComponent(lastName)}&email=${encodeURIComponent(email)}`,
      line_items: [{ quantity: 1, price: priceConfig.priceId }],
      customer_email: email,
      customer_creation: "always",
      client_reference_id: renewalId,
      payment_intent_data: { receipt_email: email, setup_future_usage: "off_session" },
      metadata: {
        flow: "renewal", tier: "am", renewal_id: renewalId, renewal_year: String(year),
        first_name: firstName, last_name: lastName, email, phone: "",
        pd_entries: "", amount_cents: String(priceConfig.unitAmount),
      },
    }, { idempotencyKey: `renewal:am:${renewalId}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return serverError("CHECKOUT_ERROR", msg, isStripeRetryableError(err));
  }

  return new Response(JSON.stringify({ url: session.url, renewalId }), {
    status: 200, headers: { "content-type": "application/json" },
  });
};
