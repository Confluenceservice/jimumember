import type { PaymentProvider } from "../types";

const notImplemented = (): never => {
  throw new Error("Stripe adapter not implemented yet");
};

// Placeholder until the adapter lands (plan 1, Tasks 4-5).
export const stripeProvider: PaymentProvider = {
  id: "stripe",
  missingConfig: notImplemented,
  resolvePrice: notImplemented,
  findReturningCustomer: notImplemented,
  createCheckout: notImplemented,
  getCheckout: notImplemented,
  ensureSubscription: notImplemented,
  parseWebhook: notImplemented,
  healthCheck: notImplemented,
  isRetryableError: notImplemented,
  userFacingError: notImplemented,
};
