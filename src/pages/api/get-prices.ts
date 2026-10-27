import type { APIRoute } from "astro";
import { formatAmount, type MembershipPlan } from "../../lib/membership-terms";
import { getPaymentProvider } from "../../lib/payments";
import { logger } from "../../lib/logger";

type PriceInfo = {
  amount: number; // in cents
  formatted: string; // e.g. "$50.00"
};

type PricesResponse = Partial<Record<MembershipPlan, PriceInfo>>;

export const GET: APIRoute = async () => {
  const provider = getPaymentProvider();
  const missing = provider.missingConfig("api");
  if (missing.length > 0) {
    return Response.json({ error: `Server is missing ${missing[0]}.` }, { status: 500 });
  }

  const plans: MembershipPlan[] = ["basic", "advanced"];
  const prices: PricesResponse = {};

  for (const plan of plans) {
    try {
      const price = await provider.resolvePrice(plan, "application");
      if (price.unitAmount) {
        prices[plan] = {
          amount: price.unitAmount,
          formatted: formatAmount(price.unitAmount),
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("MISSING_CONFIG")) {
        logger.warn(`get_prices.missing_price_id`, { plan });
      } else {
        logger.error(`get_prices.retrieve_failed`, { plan, error: message });
      }
    }
  }

  return Response.json(prices);
};
