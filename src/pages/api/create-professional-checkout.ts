import type { APIRoute } from "astro";
import Stripe from "stripe";
import * as Sentry from "@sentry/node";
import {
  calcFirstTermAmount,
  formatAmountNzd,
  getNextJulyAnchorEpoch,
  getSiteBaseUrl,
} from "../../lib/stripe-checkout";
import { logger } from "../../lib/logger";

type CreateSessionPayload = {
  plan?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
};

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

async function getExistingCustomerInfo(
  stripe: Stripe,
  email: string,
): Promise<{ id?: string; hasPriorSubscriptions: boolean }> {
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
  if (plan !== "professional") {
    return badRequest("Invalid plan. Use 'professional'.");
  }

  const firstName = payload.firstName?.trim();
  const lastName = payload.lastName?.trim();
  const phone = payload.phone?.trim();
  const email = payload.email?.trim().toLowerCase();

  if (!firstName) return badRequest("Provide a first name.");
  if (!lastName) return badRequest("Provide a last name.");
  if (!email) return badRequest("Provide an email.");

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return Response.json(
      { error: "Server is missing STRIPE_SECRET_KEY." },
      { status: 500 },
    );
  }

  const stripe = new Stripe(secretKey);
  const recurringPriceId = process.env.STRIPE_PRICE_PROFESSIONAL?.trim();
  const billingCycleAnchor = getNextJulyAnchorEpoch();
  const siteBaseUrl = getSiteBaseUrl(request.url);

  if (!recurringPriceId) {
    return Response.json(
      { error: "Server is missing STRIPE_PRICE_PROFESSIONAL." },
      { status: 500 },
    );
  }

  const recurringPrice = await stripe.prices.retrieve(recurringPriceId);
  if (recurringPrice.currency !== "nzd" || !recurringPrice.unit_amount) {
    return Response.json(
      { error: "Recurring price must be a fixed NZD amount." },
      { status: 500 },
    );
  }

  const annualAmount = recurringPrice.unit_amount;
  const customerInfo = await getExistingCustomerInfo(stripe, email);

  // First-term amount: prorated based on weeks remaining until next July 1.
  const firstTermAmount = customerInfo.hasPriorSubscriptions
    ? annualAmount
    : calcFirstTermAmount(annualAmount);

  const renewalMessage = `Then ${formatAmountNzd(annualAmount)} per year starting 1 July.`;

  // Professional uses same Option C pattern: one-time first term, subscription created in webhook
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    success_url: `${siteBaseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteBaseUrl}/professional/cancel`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "nzd",
          unit_amount: firstTermAmount,
          product_data: {
            name: "Professional Membership",
            description: renewalMessage,
          },
        },
      },
    ],
    metadata: {
      flow: "option_c",
      plan: "professional",
      recurring_price_id: recurringPriceId,
      annual_amount: String(annualAmount),
      next_july1_epoch: String(billingCycleAnchor),
      renewal_message: renewalMessage,
      first_name: firstName,
      last_name: lastName,
      phone: phone ?? "",
    },
    custom_text: {
      submit: {
        message: renewalMessage,
      },
    },
  };

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

    const proratedFirstTerm = firstTermAmount !== annualAmount;

    logger.info("checkout_session.created", {
      plan,
      sessionId: session.id,
      customerId: customerInfo.id,
      firstTermAmount,
      annualAmount,
      proratedFirstTerm,
      billingCycleAnchor,
    });

    return Response.json({
      id: session.id,
      url: session.url,
      plan,
      firstTermAmount,
      annualAmount,
      billingCycleAnchor,
      proratedFirstTerm,
      renewalMessage,
    });
  } catch (error) {
    Sentry.captureException(error, { extra: { plan, email } });
    const message =
      error instanceof Stripe.errors.StripeError
        ? error.message
        : "Unable to create checkout session.";
    logger.error("checkout_session.create_failed", {
      plan,
      error: message,
    });
    return Response.json({ error: message }, { status: 500 });
  }
};
