import type { APIRoute } from "astro";
import Stripe from "stripe";
import {
  formatAmountNzd,
  getFirstTermAmount,
  getNextJulyAnchorEpoch,
  getPlanDisplayName,
  getPriceForPlan,
  getSiteBaseUrl,
  isPromoWindowNz,
  type MembershipPlan,
} from "../../lib/stripe-checkout";

type CreateSessionPayload = {
  plan?: MembershipPlan;
  email?: string;
  promoCode?: string;
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

  const secretKey = import.meta.env.STRIPE_SECRET_KEY?.trim();
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

  // First-time subscriber in promo window without prior subscriptions
  const promoApplied =
    inPromoWindow &&
    !customerInfo.hasPriorSubscriptions;

  const dueTodayAmount = getFirstTermAmount(annualAmount, inPromoWindow, promoApplied);

  const planDisplayName = getPlanDisplayName(plan);
  const renewalMessage = `Then ${formatAmountNzd(annualAmount)} per year starting 1 July.`;

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    success_url: `${siteBaseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteBaseUrl}/cancel`,
    allow_promotion_codes: true,
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: {
        flow: "option_c",
        plan,
        recurring_price_id: recurringPriceId,
        billing_anchor_epoch: String(billingCycleAnchor),
      },
    },
    metadata: {
      flow: "option_c",
      plan,
      recurring_price_id: recurringPriceId,
      billing_anchor_epoch: String(billingCycleAnchor),
      annual_amount: String(annualAmount),
      due_today_amount: String(dueTodayAmount),
      promo_applied: promoApplied ? "true" : "false",
      renewal_message: renewalMessage,
    },
    custom_text: {
      submit: {
        message: renewalMessage,
      },
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "nzd",
          unit_amount: dueTodayAmount,
          product_data: {
            name: `${planDisplayName} (first term payment)`,
            description: renewalMessage,
          },
        },
      },
    ],
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
      dueTodayAmount,
      annualAmount,
      billingCycleAnchor,
      promoApplied,
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
