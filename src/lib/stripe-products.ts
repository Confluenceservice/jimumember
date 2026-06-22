import Stripe from "stripe";

export type LookupKey = "pm_renewal_nzd" | "am_renewal_nzd";

interface CachedPrice {
  priceId: string;
  currency: string;
  unitAmount: number;
  resolvedAt: number;
}

const priceCache = new Map<LookupKey, CachedPrice>();
const CACHE_TTL_MS = 5 * 60 * 1000;

let stripeInstance: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("MISSING_CONFIG: STRIPE_SECRET_KEY");
    stripeInstance = new Stripe(key, { apiVersion: "2026-02-25.clover" as Stripe.LatestApiVersion });
  }
  return stripeInstance;
}

function getProductEnvVar(lookupKey: LookupKey): string | undefined {
  return lookupKey === "pm_renewal_nzd"
    ? process.env.STRIPE_PRODUCT_PM_RENEWAL
    : process.env.STRIPE_PRODUCT_AM_RENEWAL;
}

export async function resolveRenewalPrice(
  lookupKey: LookupKey
): Promise<{ priceId: string; currency: string; unitAmount: number }> {
  const cached = priceCache.get(lookupKey);
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS) {
    return { priceId: cached.priceId, currency: cached.currency, unitAmount: cached.unitAmount };
  }

  const productEnvVar = getProductEnvVar(lookupKey);
  if (!productEnvVar) {
    throw new Error(`MISSING_CONFIG: STRIPE_PRODUCT_${lookupKey === "pm_renewal_nzd" ? "PM" : "AM"}_RENEWAL not set`);
  }

  const stripe = getStripe();
  const prices = await stripe.prices.list({
    product: productEnvVar,
    active: true,
    lookup_keys: [lookupKey],
    limit: 1,
  });

  if (!prices.data.length) {
    throw new Error(`PRICE_INACTIVE: no active price for lookup_key ${lookupKey} on product ${productEnvVar}`);
  }

  const price = prices.data[0];
  if (price.currency !== "nzd") {
    throw new Error(`INVALID_CURRENCY: price for ${lookupKey} returned currency=${price.currency}, expected nzd`);
  }
  if (price.unit_amount === null || price.unit_amount === undefined) {
    throw new Error(`INVALID_UNIT_AMOUNT: price for ${lookupKey} returned unit_amount=${price.unit_amount}`);
  }

  priceCache.set(lookupKey, {
    priceId: price.id,
    currency: price.currency,
    unitAmount: price.unit_amount,
    resolvedAt: Date.now(),
  });
  return { priceId: price.id, currency: price.currency, unitAmount: price.unit_amount };
}

export function invalidateRenewalPriceCache(): void {
  priceCache.clear();
}