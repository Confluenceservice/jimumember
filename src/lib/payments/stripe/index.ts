import Stripe from "stripe";
import type { HealthStatus, PaymentProvider, ReturningCustomer } from "../types";
import { createStripeCheckout, ensureStripeSubscription, getStripeCheckout } from "./checkout";
import { getStripeClient } from "./client";
import { resolveStripePrice } from "./prices";
import { parseStripeWebhook } from "./webhook";

function envSet(name: string): boolean {
  return !!process.env[name]?.trim();
}

export const stripeProvider: PaymentProvider = {
  id: "stripe",

  missingConfig(scope) {
    const names = scope === "webhook" ? ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] : ["STRIPE_SECRET_KEY"];
    return names.filter((n) => !envSet(n));
  },

  resolvePrice: resolveStripePrice,

  async findReturningCustomer(email): Promise<ReturningCustomer | null> {
    const stripe = getStripeClient();
    const customers = await stripe.customers.list({ email, limit: 1 });
    const customerRef = customers.data[0]?.id;
    if (!customerRef) return null;
    const subs = await stripe.subscriptions.list({ customer: customerRef, status: "all", limit: 1 });
    return { customerRef, hadSubscription: subs.data.length > 0 };
  },

  createCheckout: createStripeCheckout,
  getCheckout: getStripeCheckout,
  ensureSubscription: ensureStripeSubscription,
  parseWebhook: parseStripeWebhook,

  async healthCheck(): Promise<HealthStatus> {
    if (!envSet("STRIPE_SECRET_KEY")) return { status: "not_configured" };
    try {
      await getStripeClient().products.list({ limit: 1 });
      return { status: "connected" };
    } catch (err) {
      return { status: "disconnected", error: err instanceof Error ? err.message : String(err) };
    }
  },

  isRetryableError(err) {
    // Walk `cause` so a Stripe error wrapped by the price resolver still counts.
    for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
      if (e.name === "StripeConnectionError" || e.name === "StripeAPIError") return true;
    }
    return false;
  },

  userFacingError(err) {
    return err instanceof Stripe.errors.StripeError ? err.message : null;
  },
};
