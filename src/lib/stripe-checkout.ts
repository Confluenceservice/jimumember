import { DateTime } from "luxon";

export type MembershipPlan = "associate" | "professional";

const NZ_TIMEZONE = "Pacific/Auckland";

export function isPromoWindowNz(now: DateTime = DateTime.utc()): boolean {
  const nzNow = now.setZone(NZ_TIMEZONE);
  return nzNow.month >= 1 && nzNow.month <= 6;
}

export function getNextJulyAnchorDate(now: DateTime = DateTime.utc()): DateTime {
  const nzNow = now.setZone(NZ_TIMEZONE);
  const anchorYear = nzNow.month >= 7 ? nzNow.year + 1 : nzNow.year;

  return DateTime.fromObject(
    {
      year: anchorYear,
      month: 7,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    },
    { zone: NZ_TIMEZONE },
  );
}

export function getNextJulyAnchorEpoch(now: DateTime = DateTime.utc()): number {
  return Math.floor(getNextJulyAnchorDate(now).toSeconds());
}

export type ProrationUnit = "week" | "month";

/**
 * Calculate first-term amount using proration from now until next July 1.
 * Rounds to nearest cent (whole number of cents).
 */
export function calcFirstTermAmount(
  annualAmountCents: number,
  now: DateTime = DateTime.utc(),
  unit: ProrationUnit = "week",
): number {
  const nextJuly = getNextJulyAnchorDate(now);
  const nowInNz = now.setZone(NZ_TIMEZONE);

  if (unit === "week") {
    const diff = nextJuly.diff(nowInNz, "weeks");
    const weeksRemaining = diff.weeks;
    // Rounding: use Math.round to round to nearest cent
    return Math.round(annualAmountCents * (weeksRemaining / 52));
  } else {
    // month-based: uses fractional months
    const diff = nextJuly.diff(nowInNz, "months");
    const monthsRemaining = diff.months;
    return Math.round(annualAmountCents * (monthsRemaining / 12));
  }
}

export function getSiteBaseUrl(requestUrl: string): string {
  const configured = process.env.PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(requestUrl).origin;
}

export function getPriceForPlan(plan: MembershipPlan): string {
  const map: Record<MembershipPlan, string> = {
    associate: process.env.STRIPE_PRICE_ASSOCIATE ?? "",
    professional: process.env.STRIPE_PRICE_PROFESSIONAL ?? "",
  };

  return map[plan];
}

export function getPlanDisplayName(plan: MembershipPlan): string {
  return plan === "associate" ? "Associate Membership" : "Professional Membership";
}

export function formatAmountNzd(amountInCents: number): string {
  return `NZ$${(amountInCents / 100).toFixed(2)}`;
}
