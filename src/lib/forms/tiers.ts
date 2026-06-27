/**
 * Tier configuration — single source of truth for membership tiers.
 *
 * Owns every per-tier value that was previously scattered across:
 *   - `renewal-sheet.ts` (the `tier` enum in `RenewalInput`)
 *   - four env vars (`STRIPE_PRICE_PROFESSIONAL`, `STRIPE_PRICE_ASSOCIATE`,
 *     `STRIPE_PRICE_PROFESSIONAL_RENEWAL`, `STRIPE_PRICE_ASSOCIATE_RENEWAL`)
 *   - two API routes (`checkout-pm.ts` + `checkout-am.ts`)
 *   - two Astro pages (`renew/pro.astro` + `renew/associate.astro`)
 *   - the `LookupKey` enum in `stripe-products.ts`
 *
 * Adding a third tier is now one entry here + two schema files
 * (`renew${Tier}.ts` / `apply${Tier}.ts`) + a Stripe price — no API code
 * edits. Caveat: the legacy `getRenewalById` reader defaults unknown
 * values to `"pm"`; it stays as-is until Phase D makes it data-driven.
 *
 * Two axes, not one (plan finding C1): "tier" and "flow" are orthogonal.
 * The renewal route (one-time payment → 14-col `Renewals` sheet) uses
 * `getTier(slug)` end-to-end. The application/subscription flows
 * (`create-checkout-session.ts`, `create-professional-checkout.ts`)
 * reuse `validateTier` / `toRow` for validation + field mapping only —
 * they keep their own handlers because they write different sheets and
 * run deferred-subscription flows.
 */

export interface TierConfig {
  /** URL slug — also the route segment for dynamic `[tier]` routes. */
  slug: string;
  /** Full display label, e.g. "Professional Membership". */
  label: string;
  /** Short label for compact UI, e.g. "Pro". */
  shortLabel: string;
  /**
   * Legacy `tier` enum value written to the `Renewals` sheet `tier` column
   * AND to Stripe `metadata.tier`. Kept as `"pm"` / `"am"` because the
   * webhook + `getRenewalById` are readers of that contract (plan finding C3).
   */
  storageValue: string;
  /** Env var holding the Stripe price ID for the application flow. */
  priceEnvVar: string;
  /** Env var holding the Stripe price ID for the renewal flow. */
  renewalPriceEnvVar: string;
  /** Schema id used by `loadSchema` for the application form. */
  applicationSchemaId: string;
  /** Schema id used by `loadSchema` for the renewal form. */
  renewalSchemaId: string;
  /** Sheet tab for application rows. */
  sheetName: string;
  /** Sheet tab for renewal rows (shared across tiers). */
  renewalSheetName: string;
}

export const TIERS = Object.freeze({
  advanced: {
    slug: "advanced",
    label: "Advanced Membership",
    shortLabel: "Advanced",
    storageValue: "adv",
    priceEnvVar: "STRIPE_PRICE_ADVANCED",
    renewalPriceEnvVar: "STRIPE_PRICE_ADVANCED_RENEWAL",
    applicationSchemaId: "advancedApply",
    renewalSchemaId: "renewAdvanced",
    sheetName: "Advanced Applications",
    renewalSheetName: "Renewals",
  },
  basic: {
    slug: "basic",
    label: "Basic Membership",
    shortLabel: "Basic",
    storageValue: "basic",
    priceEnvVar: "STRIPE_PRICE_BASIC",
    renewalPriceEnvVar: "STRIPE_PRICE_BASIC_RENEWAL",
    applicationSchemaId: "basicApply",
    renewalSchemaId: "renewBasic",
    sheetName: "Basic Applications",
    renewalSheetName: "Renewals",
  },
} as const);

export class UnknownTierError extends Error {
  constructor(slug: string) {
    super(`Unknown tier: ${slug}`);
    this.name = "UnknownTierError";
  }
}

export function getTier(slug: string): TierConfig {
  const tier = (TIERS as Record<string, TierConfig>)[slug];
  if (!tier) throw new UnknownTierError(slug);
  return tier;
}

export function listTiers(): TierConfig[] {
  return Object.values(TIERS) as TierConfig[];
}