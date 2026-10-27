import type { logger } from "../logger";

export type ProviderId = "stripe" | "airwallex";
export type PriceKind = "application" | "renewal";

/** Placeholder routes put in `successUrl`; the adapter swaps in its own checkout-id token. */
export const CHECKOUT_REF_PLACEHOLDER = "{CHECKOUT_REF}";

export interface PriceInfo {
  priceRef: string;
  currency: string;
  unitAmount: number;
}

export interface ReturningCustomer {
  customerRef: string;
  hadSubscription: boolean;
}

export type CheckoutLineItem =
  | { kind: "price"; priceRef: string }
  | { kind: "amount"; amount: number; currency: string; name: string; description?: string };

export interface CheckoutInput {
  mode: "one_time" | "first_term_then_annual";
  lineItem: CheckoutLineItem;
  customerEmail: string;
  /** Reuse an existing customer; otherwise the provider creates one. */
  customerRef?: string;
  clientReference: string;
  metadata: Record<string, string>;
  /** May contain CHECKOUT_REF_PLACEHOLDER. */
  successUrl: string;
  cancelUrl: string;
  submitMessage?: string;
  idempotencyKey: string;
}

export interface CheckoutResult {
  checkoutRef: string;
  redirectUrl: string;
}

export interface CheckoutSummary {
  checkoutRef: string;
  metadata: Record<string, string>;
  customerEmail: string | null;
  amountTotal: number | null;
  customerRef: string | null;
}

export interface EnsureSubscriptionInput {
  checkoutRef: string;
  customerRef: string;
  paymentRef: string | null;
  priceRef: string;
  anchorEpoch: number;
  plan: string;
}

export type PaymentEvent =
  | {
      type: "checkout_completed";
      provider: ProviderId;
      checkoutRef: string;
      paymentRef: string | null;
      customerRef: string | null;
      customerEmail: string | null;
      amountTotal: number;
      paidAt: string;
      metadata: Record<string, string>;
    }
  | {
      type: "renewal_charged";
      provider: ProviderId;
      providerRef: string;
      customerRef: string;
      subscriptionRef: string;
      amount: number;
      currency: string;
      customerName: string;
      customerEmail: string;
      periodStartEpoch: number;
      paidAt: string;
      subscriptionMetadata: Record<string, string>;
    }
  | {
      type: "renewal_failed";
      provider: ProviderId;
      providerRef: string;
      customerRef: string;
      metadata: Record<string, string>;
    }
  | {
      type: "subscription_updated" | "subscription_cancelled";
      provider: ProviderId;
      subscriptionRef: string;
      customerRef: string;
      status: string;
      metadata: Record<string, string>;
    };

export interface ParsedWebhook {
  eventType: string;
  apiVersion: string;
  event: PaymentEvent | null;
  ignoredReason?: string;
}

export interface HealthStatus {
  status: "connected" | "disconnected" | "not_configured";
  error?: string;
}

export type PaymentLogger = ReturnType<typeof logger.child>;

export interface PaymentProvider {
  readonly id: ProviderId;
  /** Env var names that are unset for the given scope. */
  missingConfig(scope: "api" | "webhook"): string[];
  resolvePrice(tierSlug: string, kind: PriceKind): Promise<PriceInfo>;
  findReturningCustomer(email: string): Promise<ReturningCustomer | null>;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  getCheckout(checkoutRef: string): Promise<CheckoutSummary>;
  ensureSubscription(
    input: EnsureSubscriptionInput,
    log?: PaymentLogger,
  ): Promise<{ subscriptionRef: string }>;
  parseWebhook(rawBody: string, headers: Headers): Promise<ParsedWebhook>;
  healthCheck(): Promise<HealthStatus>;
  isRetryableError(err: unknown): boolean;
  /** The provider's own error message when safe to show, else null. */
  userFacingError(err: unknown): string | null;
}
