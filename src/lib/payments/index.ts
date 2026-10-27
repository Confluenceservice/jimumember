import { PaymentConfigError } from "./errors";
import { stripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

export * from "./types";
export * from "./errors";

/**
 * The active payment provider, chosen by PAYMENT_PROVIDER (default "stripe").
 * Re-reads the env on every call so a misconfiguration surfaces at the first
 * request that needs a provider.
 */
export function getPaymentProvider(): PaymentProvider {
  const raw = (process.env.PAYMENT_PROVIDER ?? "").trim().toLowerCase() || "stripe";
  if (raw === "stripe") return stripeProvider;
  if (raw === "airwallex") {
    throw new PaymentConfigError("PAYMENT_PROVIDER=airwallex is not available in this build");
  }
  throw new PaymentConfigError(`Unknown PAYMENT_PROVIDER "${raw}" (expected stripe|airwallex)`);
}
