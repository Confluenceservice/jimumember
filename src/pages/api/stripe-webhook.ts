import type { APIRoute } from "astro";
import Stripe from "stripe";
import {
  getMembership,
  hasActiveSubscription,
  setAwaitingSubscription,
  setActive,
  setCancelled,
  setPaymentFailed,
} from "../../lib/memberships";
import { appendCheckoutLog } from "../../lib/google-sheets";

/**
 * Option C (mode=payment):
 * - Checkout charges the first term as a one-time payment
 * - This webhook creates the recurring subscription with trial_end = next July 1
 * - Idempotency key prevents duplicate subscription creation
 */
async function handleCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  // Only handle Option C flow
  if (session.metadata?.flow !== "option_c") return;

  // Option C uses mode=payment, not mode=subscription
  if (session.mode !== "payment") return;

  const recurringPriceId = session.metadata?.recurring_price_id;
  const plan = session.metadata?.plan;
  const nextJuly1Epoch = parseInt(session.metadata?.next_july1_epoch ?? "0", 10);
  const customerId =
    typeof session.customer === "string" ? session.customer : undefined;

  if (!customerId || !recurringPriceId) return;

  // Already processed this checkout session? (idempotency via local record)
  const existing = getMembership(customerId);
  if (existing?.subscriptionId) {
    // Already created subscription for this customer
    return;
  }

  // Retrieve the PaymentIntent to get the saved payment method
  let paymentMethodId: string | undefined;
  if (session.payment_intent && typeof session.payment_intent === "string") {
    try {
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
      paymentMethodId =
        typeof pi.payment_method === "string"
          ? pi.payment_method
          : pi.payment_method?.id;
    } catch {
      // Continue without payment method - subscription creation may still work
    }
  }

  // Create the recurring subscription with trial ending at July 1
  // Use checkout session id as idempotency key to prevent duplicates
  const subscriptionParams: Stripe.SubscriptionCreateParams = {
    customer: customerId,
    items: [{ price: recurringPriceId }],
    trial_end: nextJuly1Epoch,
    metadata: {
      flow: "option_c",
      plan: plan ?? "",
      checkout_session_id: session.id,
    },
    // Expand to get default payment method
    expand: ["default_payment_method"],
  };

  // Attach the payment method from the checkout if available
  if (paymentMethodId) {
    try {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
      subscriptionParams.default_payment_method = paymentMethodId;
    } catch {
      // Payment method attachment failed — proceed without it
    }
  }

  let subscriptionId: string;
  try {
    const subscription = await stripe.subscriptions.create(subscriptionParams, {
      idempotencyKey: `option_c_sub_${session.id}`,
    });
    subscriptionId = subscription.id;
  } catch (error) {
    // If subscription creation fails (e.g., duplicate), log and rethrow
    console.error("Failed to create subscription:", error);
    throw error;
  }

  // Record the deferred subscription creation
  setAwaitingSubscription(customerId, {
    plan: plan || "",
    recurringPriceId,
    nextJuly1Epoch,
    joinedAt: new Date().toISOString(),
    subscriptionId,
  });

  // Mark as active since subscription is now set up
  setActive(customerId, subscriptionId);

  // Log to Google Sheets (async — don't fail the webhook if this errors)
  const amountPaid = session.amount_total ?? 0;
  const email = session.customer_email ?? "";
  appendCheckoutLog({
    timestamp: new Date().toISOString(),
    email,
    plan: plan || "",
    amountPaid,
    sessionId: session.id,
    customerId,
  }).catch((err) => {
    console.error("Google Sheets log failed:", err);
  });
}

async function handleInvoicePaid(
  invoice: Stripe.Invoice,
): Promise<void> {
  // Only handle invoices for our flow
  if (invoice.metadata?.flow !== "option_c") return;

  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : undefined;
  if (!customerId) return;

  // Check if this is a renewal (customer already has an active subscription)
  if (hasActiveSubscription(customerId)) {
    // Renewal — membership is already active
    return;
  }

  // First invoice paid — subscription should already exist from checkout.session.completed
  // This is a fallback: if the webhook order is reversed or subscription wasn't captured,
  // create a minimal local record so state is consistent.
  const membership = getMembership(customerId);
  if (!membership) {
    // Subscription might have been created by Stripe but webhook ordering is uncertain.
    // Don't create subscription here — let checkout.session.completed handle it.
    return;
  }
}

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
): Promise<void> {
  if (invoice.metadata?.flow !== "option_c") return;

  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : undefined;
  if (!customerId) return;

  setPaymentFailed(customerId);
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
): Promise<void> {
  if (subscription.metadata?.flow !== "option_c") return;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : undefined;
  if (!customerId) return;

  if (subscription.status === "canceled" || subscription.status === "unpaid") {
    setCancelled(customerId);
  }
  // 'active' and 'trialing' — membership is active, nothing to update
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<void> {
  if (subscription.metadata?.flow !== "option_c") return;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : undefined;
  if (!customerId) return;

  setCancelled(customerId);
}

export const POST: APIRoute = async ({ request }) => {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!signature || !webhookSecret || !secretKey) {
    return new Response("Missing webhook config.", { status: 400 });
  }

  const stripe = new Stripe(secretKey);
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch {
    return new Response("Invalid webhook signature.", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          stripe,
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
        );
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;
    }
  } catch {
    return new Response("Webhook processing failed.", { status: 500 });
  }

  return Response.json({ received: true });
};
