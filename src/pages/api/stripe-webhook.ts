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

async function handleCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "payment") return;
  if (session.metadata?.flow !== "option_c") return;

  const recurringPriceId = session.metadata?.recurring_price_id;
  const billingAnchorRaw = session.metadata?.billing_anchor_epoch;
  const plan = session.metadata?.plan;
  const customerId =
    typeof session.customer === "string" ? session.customer : undefined;

  if (!recurringPriceId || !billingAnchorRaw || !customerId) {
    return;
  }

  const billingAnchorEpoch = Number.parseInt(billingAnchorRaw, 10);
  if (!Number.isFinite(billingAnchorEpoch)) {
    return;
  }

  // Set default payment method for future invoices
  let paymentMethodId: string | undefined;
  if (typeof session.payment_intent === "string") {
    const paymentIntent = await stripe.paymentIntents.retrieve(
      session.payment_intent,
    );
    if (typeof paymentIntent.payment_method === "string") {
      paymentMethodId = paymentIntent.payment_method;
    }
  }

  if (paymentMethodId) {
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  // Store awaiting subscription — do NOT create subscription here.
  // Subscription is created on invoice.paid to avoid orphaned subscriptions.
  setAwaitingSubscription(customerId, {
    plan: plan || "",
    recurringPriceId,
    nextJuly1Epoch: billingAnchorEpoch,
    joinedAt: new Date().toISOString(),
  });
}

async function handleInvoicePaid(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<void> {
  // Only handle invoices for our flow
  if (invoice.metadata?.flow !== "option_c") return;

  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : undefined;
  if (!customerId) return;

  // Check if this customer already has an active subscription (renewal)
  if (hasActiveSubscription(customerId)) {
    // Renewal — update membership status
    // (Could log renewal event here)
    return;
  }

  // First invoice — create subscription
  const membership = getMembership(customerId);
  if (!membership) return;

  const trialEnd =
    membership.nextJuly1Epoch > Math.floor(Date.now() / 1000)
      ? membership.nextJuly1Epoch
      : undefined;

  const subscriptionParams: Stripe.SubscriptionCreateParams = {
    customer: customerId,
    items: [{ price: membership.recurringPriceId }],
    metadata: {
      flow: "option_c",
      plan: membership.plan,
    },
  };

  const paymentMethodId = invoice.default_payment_method
    ? (typeof invoice.default_payment_method === "string"
        ? invoice.default_payment_method
        : invoice.default_payment_method.id)
    : undefined;

  if (paymentMethodId) {
    subscriptionParams.default_payment_method = paymentMethodId;
  }

  if (trialEnd) {
    subscriptionParams.trial_end = trialEnd;
  }

  const subscription = await stripe.subscriptions.create(subscriptionParams, {
    idempotencyKey: `option-c-subscription-${customerId}-${membership.recurringPriceId}`,
  });

  setActive(customerId, subscription.id);
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
  const webhookSecret = import.meta.env.STRIPE_WEBHOOK_SECRET?.trim();
  const secretKey = import.meta.env.STRIPE_SECRET_KEY?.trim();

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
        await handleInvoicePaid(stripe, event.data.object as Stripe.Invoice);
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
