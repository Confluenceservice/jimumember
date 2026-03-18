import { DateTime } from "luxon";

export type MembershipPlan = "associate" | "professional";

const NZ_TIMEZONE = "Pacific/Auckland";

export function isPromoWindowNz(now = DateTime.now()): boolean {
  const nzNow = now.setZone(NZ_TIMEZONE);
  return nzNow.month >= 1 && nzNow.month <= 6;
}

export function getNextJulyAnchorEpoch(now = DateTime.now()): number {
  const nzNow = now.setZone(NZ_TIMEZONE);
  const anchorYear = nzNow.month >= 7 ? nzNow.year + 1 : nzNow.year;

  const julyFirstNz = DateTime.fromObject(
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

  return Math.floor(julyFirstNz.toSeconds());
}

export function getSiteBaseUrl(requestUrl: string): string {
  const configured = import.meta.env.PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(requestUrl).origin;
}

export function getPriceForPlan(plan: MembershipPlan): string {
  const map: Record<MembershipPlan, string> = {
    associate: import.meta.env.STRIPE_PRICE_ASSOCIATE,
    professional: import.meta.env.STRIPE_PRICE_PROFESSIONAL,
  };

  return map[plan];
}

export function getUpfrontPriceForPlan(
  plan: MembershipPlan,
): string | undefined {
  const map: Record<MembershipPlan, string | undefined> = {
    associate: import.meta.env.STRIPE_UPFRONT_PRICE_ASSOCIATE,
    professional: import.meta.env.STRIPE_UPFRONT_PRICE_PROFESSIONAL,
  };

  return map[plan]?.trim() || undefined;
}
