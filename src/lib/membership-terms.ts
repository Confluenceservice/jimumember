import { DateTime } from "luxon";
import { TIERS } from "./forms/tiers";
import {
  TIMEZONE,
  RENEWAL_ANCHOR_MONTH,
  RENEWAL_ANCHOR_DAY,
  formatMoney,
} from "./config";

/**
 * Phase M: derive the MembershipPlan union from TIERS so adding a tier
 * to tiers.ts auto-extends this type.
 */
export type MembershipPlan = keyof typeof TIERS;

export function isPromoWindow(now: DateTime = DateTime.utc()): boolean {
  const zonedNow = now.setZone(TIMEZONE);
  return zonedNow.month >= 1 && zonedNow.month <= 6;
}

export function getNextRenewalAnchorDate(now: DateTime = DateTime.utc()): DateTime {
  const zonedNow = now.setZone(TIMEZONE);
  const anchorYear =
    zonedNow.month >= RENEWAL_ANCHOR_MONTH ? zonedNow.year + 1 : zonedNow.year;

  return DateTime.fromObject(
    {
      year: anchorYear,
      month: RENEWAL_ANCHOR_MONTH,
      day: RENEWAL_ANCHOR_DAY,
      hour: 0,
      minute: 0,
      second: 0,
    },
    { zone: TIMEZONE },
  );
}

export function getNextRenewalAnchorEpoch(now: DateTime = DateTime.utc()): number {
  return Math.floor(getNextRenewalAnchorDate(now).toSeconds());
}

export type ProrationUnit = "week" | "month";

/**
 * Calculate first-term amount using proration from now until the next
 * renewal anchor (RENEWAL_ANCHOR_MONTH/DAY, default 1 July).
 * Rounds to nearest cent (whole number of cents).
 */
export function calcFirstTermAmount(
  annualAmountCents: number,
  now: DateTime = DateTime.utc(),
  unit: ProrationUnit = "week",
): number {
  const nextAnchor = getNextRenewalAnchorDate(now);
  const zonedNow = now.setZone(TIMEZONE);

  if (unit === "week") {
    const diff = nextAnchor.diff(zonedNow, "weeks");
    const weeksRemaining = diff.weeks;
    // Rounding: use Math.round to round to nearest cent
    return Math.round(annualAmountCents * (weeksRemaining / 52));
  } else {
    // month-based: uses fractional months
    const diff = nextAnchor.diff(zonedNow, "months");
    const monthsRemaining = diff.months;
    return Math.round(annualAmountCents * (monthsRemaining / 12));
  }
}

export function getSiteBaseUrl(requestUrl: string): string {
  // Single canonical base-URL env var (PUBLIC_APP_URL). Falls back to the
  // request origin when unset. getPublicAppUrl() in staging.ts reads the same
  // var so checkout-redirect URLs and email links never diverge.
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(requestUrl).origin;
}

export function getPlanDisplayName(plan: MembershipPlan): string {
  return TIERS[plan]?.label ?? plan;
}

export function formatAmount(amountInCents: number): string {
  return formatMoney(amountInCents);
}

export function isCheckoutDryRunEnabled(): boolean {
  const value = process.env.CHECKOUT_DRY_RUN?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
