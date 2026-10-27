import type Stripe from "stripe";
import { WebhookConfigError, WebhookSignatureError } from "../errors";
import type { ParsedWebhook, PaymentEvent } from "../types";
import { getStripeClient } from "./client";

const idOf = (v: string | { id: string } | null | undefined): string | undefined =>
  typeof v === "string" ? v : v?.id;

function ignored(eventType: string, apiVersion: string, reason: string): ParsedWebhook {
  return { eventType, apiVersion, event: null, ignoredReason: reason };
}

async function mapInvoicePaid(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<{ event: PaymentEvent } | { reason: string }> {
  // Only real anchor-date cycle invoices are renewals. Skips the $0
  // subscription_create invoice Stripe raises when the trialing subscription
  // is created (payment_succeeded fires for $0 invoices too).
  if (invoice.billing_reason !== "subscription_cycle") {
    return { reason: `billing_reason:${invoice.billing_reason}` };
  }
  if (!invoice.amount_paid) return { reason: "zero_amount" };

  const customerRef = idOf(invoice.customer as string | { id: string } | null);
  const subDetails = invoice.parent?.subscription_details ?? null;
  const subscriptionRef = idOf(subDetails?.subscription as string | { id: string } | null | undefined);
  if (!customerRef || !subscriptionRef) return { reason: "missing_ids" };

  // flow/plan live on the SUBSCRIPTION's metadata. Prefer the invoice's
  // subscription_details snapshot (no API call); retrieve for older shapes.
  let subscriptionMetadata = (subDetails?.metadata ?? {}) as Record<string, string>;
  if (!subscriptionMetadata.flow) {
    const sub = await stripe.subscriptions.retrieve(subscriptionRef);
    subscriptionMetadata = (sub.metadata ?? {}) as Record<string, string>;
  }

  return {
    event: {
      type: "renewal_charged",
      provider: "stripe",
      providerRef: invoice.id ?? "",
      customerRef,
      subscriptionRef,
      amount: invoice.amount_paid,
      currency: invoice.currency ?? "",
      customerName: invoice.customer_name ?? "",
      customerEmail: invoice.customer_email ?? "",
      periodStartEpoch: invoice.lines?.data?.[0]?.period?.start ?? invoice.created,
      paidAt: new Date().toISOString(),
      subscriptionMetadata,
    },
  };
}

export async function parseStripeWebhook(rawBody: string, headers: Headers): Promise<ParsedWebhook> {
  const signature = headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!signature || !webhookSecret) throw new WebhookConfigError();

  const stripe = getStripeClient();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    throw new WebhookSignatureError();
  }

  const eventType = event.type as string;
  const apiVersion = event.api_version ?? "unknown";

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "payment") return ignored(eventType, apiVersion, "non_payment_mode");
      return {
        eventType,
        apiVersion,
        event: {
          type: "checkout_completed",
          provider: "stripe",
          checkoutRef: session.id,
          paymentRef: typeof session.payment_intent === "string" ? session.payment_intent : null,
          customerRef: typeof session.customer === "string" ? session.customer : null,
          customerEmail: session.customer_email ?? null,
          amountTotal: session.amount_total ?? 0,
          paidAt: new Date().toISOString(),
          metadata: (session.metadata ?? {}) as Record<string, string>,
        },
      };
    }
    // invoice.payment_succeeded ONLY. Do not also subscribe to invoice.paid
    // (fires additionally for out-of-band payments): two subscriptions means
    // every renewal processed twice. Keep the Stripe dashboard endpoint's
    // event list in sync.
    case "invoice.payment_succeeded": {
      const mapped = await mapInvoicePaid(stripe, event.data.object as Stripe.Invoice);
      return "event" in mapped
        ? { eventType, apiVersion, event: mapped.event }
        : ignored(eventType, apiVersion, mapped.reason);
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      if (typeof invoice.customer !== "string") return ignored(eventType, apiVersion, "missing_ids");
      return {
        eventType,
        apiVersion,
        event: {
          type: "renewal_failed",
          provider: "stripe",
          providerRef: invoice.id ?? "",
          customerRef: invoice.customer,
          metadata: (invoice.metadata ?? {}) as Record<string, string>,
        },
      };
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      if (typeof sub.customer !== "string") return ignored(eventType, apiVersion, "missing_ids");
      const cancelled =
        event.type === "customer.subscription.deleted" ||
        sub.status === "canceled" ||
        sub.status === "unpaid";
      return {
        eventType,
        apiVersion,
        event: {
          type: cancelled ? "subscription_cancelled" : "subscription_updated",
          provider: "stripe",
          subscriptionRef: sub.id,
          customerRef: sub.customer,
          status: sub.status,
          metadata: (sub.metadata ?? {}) as Record<string, string>,
        },
      };
    }
    default:
      return ignored(eventType, apiVersion, "unhandled_type");
  }
}
