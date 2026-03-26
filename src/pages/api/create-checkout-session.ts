import type { APIRoute } from "astro";
import Stripe from "stripe";
import {
  formatAmountNzd,
  getNextJulyAnchorEpoch,
  getPriceForPlan,
  getSiteBaseUrl,
  isPromoWindowNz,
  type MembershipPlan,
} from "../../lib/stripe-checkout";

type CreateSessionPayload = {
  plan?: MembershipPlan;
  email?: string;
};

type ExistingCustomerInfo = {
  id?: string;
  hasPriorSubscriptions: boolean;
};

const VALID_PLANS: MembershipPlan[] = ["associate", "professional"];

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

async function getExistingCustomerInfo(
  stripe: Stripe,
  email: string,
): Promise<ExistingCustomerInfo> {
  const customers = await stripe.customers.list({ email, limit: 1 });
  const customerId = customers.data[0]?.id;

  if (!customerId) {
    return { hasPriorSubscriptions: false };
  }

  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 1,
  });

  return {
    id: customerId,
    hasPriorSubscriptions: subs.data.length > 0,
  };
}

/**
 * Option C: mode=payment (one-time charge)
 * - First term is charged at checkout as a one-time payment
 * - Webhook creates the recurring subscription deferred with trial_end = next July 1
 * - Payment method is saved for future off-session charges
 */
export const POST: APIRoute = async ({ request }) => {
  let payload: CreateSessionPayload;

  try {
    payload = (await request.json()) as CreateSessionPayload;
  } catch {
    return badRequest("Invalid JSON payload.");
  }

  const plan = payload.plan;
  if (!plan || !VALID_PLANS.includes(plan)) {
    return badRequest("Invalid plan. Use 'associate' or 'professional'.");
  }

  const email = payload.email?.trim().toLowerCase();
  if (!email) {
    return badRequest("Provide an email.");
  }

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return Response.json(
      { error: "Server is missing STRIPE_SECRET_KEY." },
      { status: 500 },
    );
  }

  const stripe = new Stripe(secretKey);
  const recurringPriceId = getPriceForPlan(plan);
  const billingCycleAnchor = getNextJulyAnchorEpoch();
  const siteBaseUrl = getSiteBaseUrl(request.url);

  const recurringPrice = await stripe.prices.retrieve(recurringPriceId);
  if (recurringPrice.currency !== "nzd" || !recurringPrice.unit_amount) {
    return Response.json(
      { error: "Recurring price must be a fixed NZD amount." },
      { status: 500 },
    );
  }

  const annualAmount = recurringPrice.unit_amount;
  const customerInfo = await getExistingCustomerInfo(stripe, email);
  const inPromoWindow = isPromoWindowNz();
  const eligibleForPromo = inPromoWindow && !customerInfo.hasPriorSubscriptions;

  // First-term amount: 50% off for Jan-Jun first-time subscribers, full price otherwise.
  // mode=payment doesn't show a promo code field on hosted checkout, so we compute
  // the discount here and pass the resulting amount directly to price_data.
  const firstTermAmount = eligibleForPromo
    ? Math.round(annualAmount * 0.5)
    : annualAmount;

  const renewalMessage = `Then ${formatAmountNzd(annualAmount)} per year starting 1 July.`;

  // mode=payment for Option C: one-time charge, subscription created in webhook
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    success_url: `${siteBaseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteBaseUrl}/cancel`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "nzd",
          unit_amount: firstTermAmount,
          product_data: {
            name: plan === "associate" ? "Associate Membership" : "Professional Membership",
            description: renewalMessage,
          },
        },
      },
    ],
    metadata: {
      flow: "option_c",
      plan,
      recurring_price_id: recurringPriceId,
      annual_amount: String(annualAmount),
      next_july1_epoch: String(billingCycleAnchor),
      renewal_message: renewalMessage,
    },
    custom_text: {
      submit: {
        message: renewalMessage,
      },
    },
  };

  // Save payment method for future off-session charges (renewal billing)
  params.payment_intent_data = {
    setup_future_usage: "off_session",
  };

  if (customerInfo.id) {
    params.customer = customerInfo.id;
  } else {
    params.customer_creation = "always";
    params.customer_email = email;
  }

  try {
    const session = await stripe.checkout.sessions.create(params);

    return Response.json({
      id: session.id,
      url: session.url,
      plan,
      firstTermAmount,
      annualAmount,
      billingCycleAnchor,
      eligibleForPromo,
      renewalMessage,
    });
  } catch (error) {
    const message =
      error instanceof Stripe.errors.StripeError
        ? error.message
        : "Unable to create checkout session.";

    return Response.json({ error: message }, { status: 500 });
  }
};
