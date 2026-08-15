import type Stripe from "stripe";
import { logger } from "./logger";

/**
 * Extracts the facts Xero needs from a Stripe payment: WHEN the money
 * actually moved, and what Stripe took.
 *
 * The date is the whole point. A Xero payment must carry the BALANCE
 * TRANSACTION date, not the moment this code happens to run. The Stripe
 * bank feed imports charge lines dated by the balance transaction, so a
 * payment dated in a different period simply will not auto-match, and the
 * clearing account never nets to zero — silently, because nothing errors.
 *
 * The fee is recorded for reconciliation only. Bank rules on the feed
 * account do the actual fee accounting (see the plan's D2), but without the
 * number on the row a mismatch is impossible to investigate.
 *
 * NEVER throws. A payment whose facts cannot be resolved still has to reach
 * Xero — a slightly wrong date is recoverable by hand, a dropped invoice is
 * not. Failure falls back to the object's own `created` timestamp and a
 * zero fee, and says so in the logs.
 */

export interface PaymentFacts {
  /** ISO timestamp of the balance transaction (or the fallback). */
  paidAt: string;
  feeCents: number;
  netCents: number;
  /** True when the balance transaction could not be resolved. */
  fallback: boolean;
}

function isoFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Resolves the balance transaction behind a charge, expanding only what is
 * still unexpanded.
 */
async function balanceTransactionFromCharge(
  stripe: Stripe,
  charge: Stripe.Charge,
): Promise<Stripe.BalanceTransaction | null> {
  const bt = charge.balance_transaction;
  if (bt && typeof bt !== "string") return bt;
  const btId = idOf(bt);
  if (!btId) return null;
  return stripe.balanceTransactions.retrieve(btId);
}

async function fromPaymentIntent(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<Stripe.BalanceTransaction | null> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge.balance_transaction"],
  });
  const charge = pi.latest_charge;
  if (!charge || typeof charge === "string") return null;
  return balanceTransactionFromCharge(stripe, charge);
}

async function fromChargeId(
  stripe: Stripe,
  chargeId: string,
): Promise<Stripe.BalanceTransaction | null> {
  const charge = await stripe.charges.retrieve(chargeId, {
    expand: ["balance_transaction"],
  });
  return balanceTransactionFromCharge(stripe, charge);
}

/**
 * Invoices no longer carry a top-level `charge` or `payment_intent` — the
 * current API exposes `invoice.payments[].payment`, which is a union of
 * charge / payment_intent / payment_record. The list is not always present
 * on the webhook payload, so it is fetched when missing.
 */
async function fromInvoice(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<Stripe.BalanceTransaction | null> {
  let payments = invoice.payments?.data;
  if (!payments?.length && invoice.id) {
    const full = await stripe.invoices.retrieve(invoice.id, { expand: ["payments"] });
    payments = full.payments?.data;
  }

  const payment = payments?.[0]?.payment;
  if (!payment) return null;

  const paymentIntentId = idOf(payment.payment_intent);
  if (paymentIntentId) return fromPaymentIntent(stripe, paymentIntentId);

  const chargeId = idOf(payment.charge);
  if (chargeId) return fromChargeId(stripe, chargeId);

  return null;
}

type FactsSource = Stripe.Checkout.Session | Stripe.Invoice;

function fallbackFacts(source: FactsSource, reason: string, id: string): PaymentFacts {
  const amount =
    source.object === "checkout.session"
      ? (source.amount_total ?? 0)
      : (source.amount_paid ?? 0);
  logger.warn("stripe_payment_facts.fallback", { id, reason });
  return {
    paidAt: isoFromUnix(source.created),
    feeCents: 0,
    netCents: amount,
    fallback: true,
  };
}

/**
 * Resolves payment facts for a completed Checkout Session or a paid
 * Invoice. Discriminates on Stripe's own `object` field.
 */
export async function getPaymentFacts(
  stripe: Stripe,
  source: FactsSource,
): Promise<PaymentFacts> {
  const id = source.id ?? "unknown";
  try {
    let bt: Stripe.BalanceTransaction | null;

    if (source.object === "checkout.session") {
      const paymentIntentId = idOf(source.payment_intent);
      if (!paymentIntentId) {
        return fallbackFacts(source, "session has no payment_intent", id);
      }
      bt = await fromPaymentIntent(stripe, paymentIntentId);
    } else {
      bt = await fromInvoice(stripe, source);
    }

    if (!bt) return fallbackFacts(source, "no balance transaction resolved", id);

    return {
      paidAt: isoFromUnix(bt.created),
      feeCents: bt.fee ?? 0,
      netCents: bt.net ?? 0,
      fallback: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fallbackFacts(source, msg, id);
  }
}
