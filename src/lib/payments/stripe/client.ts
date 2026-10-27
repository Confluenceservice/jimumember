import Stripe from "stripe";
import { PaymentConfigError } from "../errors";

/**
 * The only place the Stripe apiVersion is pinned. Bumping the SDK means
 * migrating this literal (it must match the SDK's LatestApiVersion type).
 */
export const STRIPE_API_VERSION = "2026-06-24.dahlia" as Stripe.LatestApiVersion;

let cached: { key: string; client: Stripe } | null = null;

export function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new PaymentConfigError("MISSING_CONFIG: STRIPE_SECRET_KEY");
  if (!cached || cached.key !== key) {
    cached = { key, client: new Stripe(key, { apiVersion: STRIPE_API_VERSION }) };
  }
  return cached.client;
}

export function resetStripeClientForTests(): void {
  cached = null;
}
