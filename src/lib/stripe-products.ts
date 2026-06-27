import Stripe from "stripe";
import { getTier, UnknownTierError } from "./forms/tiers";

export type LookupKey = "pm_renewal_nzd" | "am_renewal_nzd";

interface CachedPrice {
  priceId: string;
  currency: string;
  unitAmount: number;
  resolvedAt: number;
}

// Keyed by LookupKey ("pm_renewal_nzd" / "am_renewal_nzd") for the legacy
// resolver, OR `tier:<slug>` for the tier-driven resolver. The `tier:`
// prefix keeps the two namespaces disjoint in the shared cache.
const priceCache = new Map<string, CachedPrice>();
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

function getPriceEnvVar(lookupKey: LookupKey): string | undefined {
  return lookupKey === "pm_renewal_nzd"
    ? process.env.STRIPE_PRICE_PROFESSIONAL
    : process.env.STRIPE_PRICE_ASSOCIATE;
}

export async function resolveRenewalPrice(
  lookupKey: LookupKey
): Promise<{ priceId: string; currency: string; unitAmount: number }> {
  const cached = priceCache.get(lookupKey);
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS) {
    return { priceId: cached.priceId, currency: cached.currency, unitAmount: cached.unitAmount };
  }

  const priceId = getPriceEnvVar(lookupKey);
  if (!priceId) {
    throw new Error(`MISSING_CONFIG: STRIPE_PRICE_${lookupKey === "pm_renewal_nzd" ? "PROFESSIONAL" : "ASSOCIATE"} not set`);
  }

  const stripe = getStripe();
  let price: Stripe.Price;
  try {
    price = await stripe.prices.retrieve(priceId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`PRICE_RETRIEVE_FAILED: ${msg} (priceId=${priceId})`);
  }

  if (!price.active) {
    throw new Error(`PRICE_INACTIVE: price ${priceId} is not active`);
  }
  if (price.currency !== "nzd") {
    throw new Error(`INVALID_CURRENCY: price for ${lookupKey} returned currency=${price.currency}, expected nzd`);
  }
  if (price.unit_amount === null || price.unit_amount === undefined) {
    throw new Error(`INVALID_UNIT_AMOUNT: price for ${lookupKey} returned unit_amount=${price.unit_amount}`);
  }

  const config = {
    priceId: price.id,
    currency: price.currency,
    unitAmount: price.unit_amount,
  };
  priceCache.set(lookupKey, { ...config, resolvedAt: Date.now() });
  return config;
}

// Tier-driven resolver (Phase D). The tier config owns the renewal
// price env var; the lookupKey path stays for backward compatibility
// (stripe-products.test.ts and any external callers).
export async function resolveRenewalPriceByTier(
  tierSlug: string,
): Promise<{ priceId: string; currency: string; unitAmount: number }> {
  let tier;
  try { tier = getTier(tierSlug); }
  catch (err) {
    if (err instanceof UnknownTierError) throw new Error(`MISSING_CONFIG: unknown tier ${tierSlug}`);
    throw err;
  }
  const priceId = process.env[tier.renewalPriceEnvVar];
  if (!priceId) {
    throw new Error(`MISSING_CONFIG: ${tier.renewalPriceEnvVar} not set`);
  }

  // Cache key per env-var so different tiers sharing a price don't collide.
  const cacheKey = `tier:${tierSlug}`;
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS) {
    return { priceId: cached.priceId, currency: cached.currency, unitAmount: cached.unitAmount };
  }

  const stripe = getStripe();
  let price: Stripe.Price;
  try {
    price = await stripe.prices.retrieve(priceId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`PRICE_RETRIEVE_FAILED: ${msg} (priceId=${priceId})`);
  }

  if (!price.active) {
    throw new Error(`PRICE_INACTIVE: price ${priceId} is not active`);
  }
  if (price.currency !== "nzd") {
    throw new Error(`INVALID_CURRENCY: price for tier ${tierSlug} returned currency=${price.currency}, expected nzd`);
  }
  if (price.unit_amount === null || price.unit_amount === undefined) {
    throw new Error(`INVALID_UNIT_AMOUNT: price for tier ${tierSlug} returned unit_amount=${price.unit_amount}`);
  }

  const config = {
    priceId: price.id,
    currency: price.currency,
    unitAmount: price.unit_amount,
  };
  priceCache.set(cacheKey, { ...config, resolvedAt: Date.now() });
  return config;
}

export function invalidateRenewalPriceCache(): void {
  priceCache.clear();
}