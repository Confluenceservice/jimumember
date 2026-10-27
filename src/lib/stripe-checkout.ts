import { TIERS } from "./forms/tiers";
import type { MembershipPlan } from "./membership-terms";

export function getPriceForPlan(plan: MembershipPlan): string {
  const tier = TIERS[plan];
  if (!tier) return "";
  return process.env[tier.priceEnvVar] ?? "";
}

export function isStripeRetryableError(error: unknown): boolean {
  if (error instanceof Error && error.name === "StripeConnectionError") return true;
  if (error instanceof Error && error.name === "StripeAPIError") return true;
  return false;
}
