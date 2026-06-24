import type { APIRoute } from "astro";
import Stripe from "stripe";
import { resolveRenewalPrice } from "../../../lib/stripe-products";
import { appendRenewal, type PdEntry } from "../../../lib/renewal-sheet";
import { getSiteBaseUrl, isCheckoutDryRunEnabled, isStripeRetryableError } from "../../../lib/stripe-checkout";

const EMAIL_RE = /^[^\r\n@\s]+@[^\r\n@\s]+\.[^\r\n@\s]+$/;

interface CheckoutPmBody {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  year?: number;
  pdEntries?: PdEntry[];
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

function isValidPdEntry(entry: unknown): entry is PdEntry {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.dateCompleted === "string" && e.dateCompleted.length > 0 &&
    typeof e.activity === "string" && e.activity.length > 0 &&
    typeof e.totalHours === "number" && e.totalHours > 0 &&
    typeof e.provider === "string"
  );
}

function badRequest(field: string, message: string) {
  return new Response(JSON.stringify({ error: message, field }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

function serverError(code: string, message: string, retryable = false) {
  return new Response(JSON.stringify({ error: message, code, retryable }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: CheckoutPmBody;
  try {
    body = (await request.json()) as CheckoutPmBody;
  } catch {
    return badRequest("body", "Invalid JSON");
  }

  const firstName = (body.firstName ?? "").trim();
  const lastName = (body.lastName ?? "").trim();
  const email = (body.email ?? "").trim();
  const phone = (body.phone ?? "").trim();
  const year = Number(body.year);

  if (!firstName) return badRequest("firstName", "First name required");
  if (!lastName) return badRequest("lastName", "Last name required");
  if (!EMAIL_RE.test(email)) return badRequest("email", "Valid email required");
  if (!Number.isInteger(year) || year < 2024 || year > 2100) return badRequest("year", "Valid year required");

  const pdEntries = (body.pdEntries ?? []).filter((e) => e !== null && e !== undefined);
  if (pdEntries.length > 0 && !pdEntries.every(isValidPdEntry)) {
    return badRequest("pdEntries", "Each PD entry must have dateCompleted, activity, totalHours (number > 0), provider");
  }

  let priceConfig;
  try {
    priceConfig = await resolveRenewalPrice("pm_renewal_nzd");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("MISSING_CONFIG")) return serverError("MISSING_CONFIG", msg);
    if (msg.includes("PRICE_INACTIVE")) return serverError("PRICE_INACTIVE", msg);
    return serverError("CHECKOUT_ERROR", msg);
  }

  const renewalId = crypto.randomUUID();

  if (isCheckoutDryRunEnabled()) {
    return new Response(JSON.stringify({
      dryRun: true,
      priceValidated: true,
      priceId: priceConfig.priceId,
      renewalId,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  const siteBaseUrl = getSiteBaseUrl(request.url);
  const createdAt = new Date().toISOString();

  try {
    await appendRenewal({
      renewalId, tier: "pm", year, firstName, lastName, email, phone,
      pdEntries, amountCents: priceConfig.unitAmount, currency: priceConfig.currency,
      stripeSession: "",
      paymentStatus: "pending",
      createdAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Marked retryable: client form should retry on click. The Sheets write
    // is transient (gaxios 6.x Premature close on OAuth token fetch) — a
    // retry from a fresh client context almost always succeeds.
    return serverError("SHEET_WRITE_FAILED", `Failed to write renewal row: ${msg}`, true);
  }

  let session;
  try {
    session = await getStripe().checkout.sessions.create({
      mode: "payment",
      success_url: `${siteBaseUrl}/renew/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteBaseUrl}/renew/pro?year=${year}&firstName=${encodeURIComponent(firstName)}&lastName=${encodeURIComponent(lastName)}&email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone)}`,
      line_items: [{ quantity: 1, price: priceConfig.priceId }],
      customer_email: email,
      customer_creation: "always",
      client_reference_id: renewalId,
      payment_intent_data: { receipt_email: email, setup_future_usage: "off_session" },
      metadata: {
        flow: "renewal",
        tier: "pm",
        renewal_id: renewalId,
        renewal_year: String(year),
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        pd_entries: JSON.stringify(pdEntries),
        amount_cents: String(priceConfig.unitAmount),
      },
    }, {
      idempotencyKey: `renewal:pm:${renewalId}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return serverError("CHECKOUT_ERROR", msg, isStripeRetryableError(err));
  }

  return new Response(JSON.stringify({ url: session.url, renewalId }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
