import type Stripe from "stripe";
import { logger } from "../../logger";
import {
  CHECKOUT_REF_PLACEHOLDER,
  type CheckoutInput,
  type CheckoutResult,
  type CheckoutSummary,
  type EnsureSubscriptionInput,
  type PaymentLogger,
} from "../types";
import { getStripeClient } from "./client";

export async function createStripeCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const stripe = getStripeClient();
  const item = input.lineItem;
  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem =
    item.kind === "price"
      ? { quantity: 1, price: item.priceRef }
      : {
          quantity: 1,
          price_data: {
            currency: item.currency,
            unit_amount: item.amount,
            product_data: {
              name: item.name,
              ...(item.description !== undefined ? { description: item.description } : {}),
            },
          },
        };

  // Stripe Option C is a payment-mode session for both modes: the recurring
  // subscription is created afterwards by ensureSubscription.
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    success_url: input.successUrl.replace(CHECKOUT_REF_PLACEHOLDER, "{CHECKOUT_SESSION_ID}"),
    cancel_url: input.cancelUrl,
    line_items: [lineItem],
    metadata: input.metadata,
    client_reference_id: input.clientReference,
    // Save the card for future off-session charges (renewal billing).
    payment_intent_data: { setup_future_usage: "off_session", receipt_email: input.customerEmail },
  };
  if (input.submitMessage) {
    params.custom_text = { submit: { message: input.submitMessage } };
  }
  if (input.customerRef) {
    params.customer = input.customerRef;
  } else {
    params.customer_creation = "always";
    params.customer_email = input.customerEmail;
  }

  const session = await stripe.checkout.sessions.create(params, { idempotencyKey: input.idempotencyKey });
  return { checkoutRef: session.id, redirectUrl: session.url as string };
}

export async function getStripeCheckout(checkoutRef: string): Promise<CheckoutSummary> {
  const session = await getStripeClient().checkout.sessions.retrieve(checkoutRef, {
    expand: ["line_items"],
  });
  return {
    checkoutRef: session.id,
    metadata: (session.metadata ?? {}) as Record<string, string>,
    customerEmail: session.customer_email ?? null,
    amountTotal: session.amount_total ?? null,
    customerRef:
      typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
  };
}

/**
 * Option C: the first term was charged as a one-time payment; create the
 * recurring subscription now with trial_end = next anchor date. The
 * `option_c_sub_<checkoutRef>` idempotency key makes a replay safe.
 */
export async function ensureStripeSubscription(
  input: EnsureSubscriptionInput,
  log: PaymentLogger | typeof logger = logger,
): Promise<{ subscriptionRef: string }> {
  const stripe = getStripeClient();
  const { checkoutRef, customerRef } = input;

  let paymentMethodId: string | undefined;
  if (input.paymentRef) {
    try {
      const pi = await stripe.paymentIntents.retrieve(input.paymentRef);
      paymentMethodId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
    } catch (err) {
      log.warn("checkout_completed.payment_intent_retrieve_failed", {
        customerId: customerRef,
        sessionId: checkoutRef,
        paymentIntent: input.paymentRef,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const subscriptionParams: Stripe.SubscriptionCreateParams = {
    customer: customerRef,
    items: [{ price: input.priceRef }],
    trial_end: input.anchorEpoch,
    metadata: { flow: "option_c", plan: input.plan, checkout_session_id: checkoutRef },
    expand: ["default_payment_method"],
  };

  if (paymentMethodId) {
    try {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerRef });
      await stripe.customers.update(customerRef, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
      subscriptionParams.default_payment_method = paymentMethodId;
    } catch (err) {
      log.warn("checkout_completed.payment_method_attach_failed", {
        customerId: customerRef,
        sessionId: checkoutRef,
        paymentMethodId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const subscription = await stripe.subscriptions.create(subscriptionParams, {
    idempotencyKey: `option_c_sub_${checkoutRef}`,
  });
  return { subscriptionRef: subscription.id };
}
