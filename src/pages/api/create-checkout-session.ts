import type { APIRoute } from "astro";
import Stripe from "stripe";
import {
  getNextJulyAnchorEpoch,
  getPriceForPlan,
  getSiteBaseUrl,
  getUpfrontPriceForPlan,
  isPromoWindowNz,
  type MembershipPlan,
} from "../../lib/stripe-checkout";

type CreateSessionPayload = {
  plan?: MembershipPlan;
  email?: string;
  customerId?: string;
};

const VALID_PLANS: MembershipPlan[] = ["associate", "professional"];

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
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

  const customerId = payload.customerId?.trim();
  const email = payload.email?.trim();

  if (!customerId && !email) {
    return badRequest("Provide email or customerId.");
  }

  const secretKey = import.meta.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return Response.json(
      { error: "Server is missing STRIPE_SECRET_KEY." },
      { status: 500 },
    );
  }

  const stripe = new Stripe(secretKey);
  const billingCycleAnchor = getNextJulyAnchorEpoch();
  const siteBaseUrl = getSiteBaseUrl(request.url);
  const selectedPrice = getPriceForPlan(plan);
  const upfrontPrice = getUpfrontPriceForPlan(plan);
  const promotionCodeId = import.meta.env.STRIPE_PROMO_CODE_ID?.trim();
  const inPromoWindow = isPromoWindowNz();
  const applyPromoAutomatically = inPromoWindow && Boolean(promotionCodeId);

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    success_url: `${siteBaseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteBaseUrl}/cancel`,
    metadata: {
      plan,
    },
  };

  if (customerId) {
    params.customer = customerId;
  } else if (email) {
    params.customer_email = email;
  }

  if (inPromoWindow) {
    if (!promotionCodeId) {
      return Response.json(
        { error: "Server missing STRIPE_PROMO_CODE_ID for Jan-Jun checkout." },
        { status: 500 },
      );
    }

    if (!upfrontPrice) {
      return Response.json(
        {
          error:
            "Server missing STRIPE_UPFRONT_PRICE_* for fixed first-term pricing.",
        },
        { status: 500 },
      );
    }

    params.line_items = [
      { price: selectedPrice, quantity: 1 },
      { price: upfrontPrice, quantity: 1 },
    ];
    params.subscription_data = {
      trial_end: billingCycleAnchor,
    };
    params.discounts = [{ promotion_code: promotionCodeId }];
  } else {
    params.line_items = [{ price: selectedPrice, quantity: 1 }];
    params.subscription_data = {
      billing_cycle_anchor: billingCycleAnchor,
      proration_behavior: "create_prorations",
    };
    params.allow_promotion_codes = true;
  }

  try {
    const session = await stripe.checkout.sessions.create(params);

    return Response.json({
      id: session.id,
      url: session.url,
      billingCycleAnchor,
      promoAppliedAutomatically: applyPromoAutomatically,
      plan,
    });
  } catch (error) {
    const message =
      error instanceof Stripe.errors.StripeError
        ? error.message
        : "Unable to create checkout session.";

    return Response.json({ error: message }, { status: 500 });
  }
};
