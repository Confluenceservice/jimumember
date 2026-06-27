import type { APIRoute } from "astro";
import Stripe from "stripe";
import { formatAmountNzd, getPriceForPlan, type MembershipPlan } from "../../lib/stripe-checkout";
import { logger } from "../../lib/logger";

type PriceInfo = {
  amount: number; // in cents
  formatted: string; // e.g. "NZ$50.00"
};

type PricesResponse = Partial<Record<MembershipPlan, PriceInfo>>;

export const GET: APIRoute = async ({ request }) => {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return Response.json({ error: "Server is missing STRIPE_SECRET_KEY." }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);

  const plans: MembershipPlan[] = ["basic", "advanced"];
  const prices: PricesResponse = {};

  for (const plan of plans) {
    const priceId = getPriceForPlan(plan);
    if (!priceId) {
      logger.warn(`get_prices.missing_price_id`, { plan });
      continue;
    }

    try {
      const price = await stripe.prices.retrieve(priceId);
      if (price.currency === "nzd" && price.unit_amount) {
        prices[plan] = {
          amount: price.unit_amount,
          formatted: formatAmountNzd(price.unit_amount),
        };
      }
    } catch (err) {
      logger.error(`get_prices.retrieve_failed`, { plan, priceId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return Response.json(prices);
};