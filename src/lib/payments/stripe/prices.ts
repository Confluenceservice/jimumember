import type Stripe from "stripe";
import { CURRENCY } from "../../config";
import { getTier, UnknownTierError } from "../../forms/tiers";
import type { PriceInfo, PriceKind } from "../types";
import { getStripeClient } from "./client";

interface CachedPrice extends PriceInfo {
  resolvedAt: number;
}

const priceCache = new Map<string, CachedPrice>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function resolveStripePrice(tierSlug: string, kind: PriceKind): Promise<PriceInfo> {
  let tier;
  try {
    tier = getTier(tierSlug);
  } catch (err) {
    if (err instanceof UnknownTierError) throw new Error(`MISSING_CONFIG: unknown tier ${tierSlug}`);
    throw err;
  }
  const envVar = kind === "renewal" ? tier.renewalPriceEnvVar : tier.priceEnvVar;
  const priceId = process.env[envVar];
  if (!priceId) {
    throw new Error(`MISSING_CONFIG: ${envVar} not set`);
  }

  const cacheKey = `${kind}:${tierSlug}`;
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS) {
    return { priceRef: cached.priceRef, currency: cached.currency, unitAmount: cached.unitAmount };
  }

  const stripe = getStripeClient();
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
  if (price.currency !== CURRENCY) {
    throw new Error(
      `INVALID_CURRENCY: price for tier ${tierSlug} returned currency=${price.currency}, expected ${CURRENCY}`,
    );
  }
  if (price.unit_amount === null || price.unit_amount === undefined) {
    throw new Error(`INVALID_UNIT_AMOUNT: price for tier ${tierSlug} returned unit_amount=${price.unit_amount}`);
  }

  const info: PriceInfo = { priceRef: price.id, currency: price.currency, unitAmount: price.unit_amount };
  priceCache.set(cacheKey, { ...info, resolvedAt: Date.now() });
  return info;
}

export function invalidateStripePriceCache(): void {
  priceCache.clear();
}
