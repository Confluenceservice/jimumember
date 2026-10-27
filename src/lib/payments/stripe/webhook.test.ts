import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
}));

vi.mock("stripe", () => {
  const Ctor: any = vi.fn(function () {
    return {
      webhooks: { constructEvent: m.constructEvent },
      subscriptions: { retrieve: m.subscriptionsRetrieve },
    };
  });
  Ctor.errors = { StripeError: class extends Error {} };
  return { default: Ctor };
});

import { stripeProvider } from "./index";
import { resetStripeClientForTests } from "./client";
import { WebhookConfigError, WebhookSignatureError } from "../errors";

function headers(sig: string | null = "t=1,v1=abc") {
  const h = new Headers();
  if (sig) h.set("stripe-signature", sig);
  return h;
}

function arrive(event: Record<string, unknown>) {
  m.constructEvent.mockReturnValue({ api_version: "2026-06-24.dahlia", ...event });
}

describe("stripe adapter parseWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStripeClientForTests();
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  });

  it("missing signature header throws WebhookConfigError", async () => {
    await expect(stripeProvider.parseWebhook("{}", headers(null))).rejects.toThrow(WebhookConfigError);
  });

  it("missing webhook secret throws WebhookConfigError", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await expect(stripeProvider.parseWebhook("{}", headers())).rejects.toThrow(WebhookConfigError);
  });

  it("bad signature throws WebhookSignatureError", async () => {
    m.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found");
    });
    await expect(stripeProvider.parseWebhook("{}", headers("bad"))).rejects.toThrow(WebhookSignatureError);
    expect(m.constructEvent).toHaveBeenCalledWith("{}", "bad", "whsec_test");
  });

  it("checkout.session.completed (payment mode) becomes checkout_completed", async () => {
    arrive({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          mode: "payment",
          payment_intent: "pi_1",
          customer: "cus_1",
          customer_email: "a@b.test",
          amount_total: 4588,
          metadata: { flow: "option_c", plan: "basic" },
        },
      },
    });
    const parsed = await stripeProvider.parseWebhook("{}", headers());
    expect(parsed.eventType).toBe("checkout.session.completed");
    expect(parsed.apiVersion).toBe("2026-06-24.dahlia");
    expect(parsed.event).toMatchObject({
      type: "checkout_completed",
      provider: "stripe",
      checkoutRef: "cs_1",
      paymentRef: "pi_1",
      customerRef: "cus_1",
      customerEmail: "a@b.test",
      amountTotal: 4588,
      metadata: { flow: "option_c", plan: "basic" },
    });
    expect(typeof (parsed.event as { paidAt: string }).paidAt).toBe("string");
  });

  it("checkout.session.completed tolerates missing optional fields", async () => {
    arrive({ type: "checkout.session.completed", data: { object: { id: "cs_2", mode: "payment" } } });
    const { event } = await stripeProvider.parseWebhook("{}", headers());
    expect(event).toMatchObject({ paymentRef: null, customerRef: null, customerEmail: null, amountTotal: 0, metadata: {} });
  });

  it("checkout.session.completed in subscription mode is ignored", async () => {
    arrive({ type: "checkout.session.completed", data: { object: { id: "cs_3", mode: "subscription" } } });
    const parsed = await stripeProvider.parseWebhook("{}", headers());
    expect(parsed.event).toBeNull();
    expect(parsed.ignoredReason).toBe("non_payment_mode");
  });

  const cycleInvoice = (over: Record<string, unknown> = {}) => ({
    id: "in_1",
    billing_reason: "subscription_cycle",
    amount_paid: 10000,
    currency: "usd",
    customer: "cus_1",
    customer_name: "Ann Lee",
    customer_email: "a@b.test",
    created: 1782864000,
    lines: { data: [{ period: { start: 1782864001 } }] },
    parent: { subscription_details: { subscription: "sub_1", metadata: { flow: "option_c", plan: "basic" } } },
    ...over,
  });

  it("invoice.payment_succeeded for a cycle invoice becomes renewal_charged using the invoice snapshot metadata", async () => {
    arrive({ type: "invoice.payment_succeeded", data: { object: cycleInvoice() } });
    const { event } = await stripeProvider.parseWebhook("{}", headers());
    expect(event).toMatchObject({
      type: "renewal_charged",
      provider: "stripe",
      providerRef: "in_1",
      customerRef: "cus_1",
      subscriptionRef: "sub_1",
      amount: 10000,
      currency: "usd",
      customerName: "Ann Lee",
      customerEmail: "a@b.test",
      periodStartEpoch: 1782864001,
      subscriptionMetadata: { flow: "option_c", plan: "basic" },
    });
    expect(m.subscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it("falls back to subscriptions.retrieve when the snapshot lacks flow", async () => {
    arrive({
      type: "invoice.payment_succeeded",
      data: {
        object: cycleInvoice({ parent: { subscription_details: { subscription: "sub_1", metadata: {} } } }),
      },
    });
    m.subscriptionsRetrieve.mockResolvedValue({ id: "sub_1", metadata: { flow: "option_c", plan: "advanced" } });
    const { event } = await stripeProvider.parseWebhook("{}", headers());
    expect(m.subscriptionsRetrieve).toHaveBeenCalledWith("sub_1");
    expect(event).toMatchObject({ subscriptionMetadata: { flow: "option_c", plan: "advanced" } });
  });

  it("uses invoice.created when the line has no period start, and empty strings for absent name/email", async () => {
    arrive({
      type: "invoice.payment_succeeded",
      data: { object: cycleInvoice({ lines: { data: [] }, customer_name: null, customer_email: null }) },
    });
    const { event } = await stripeProvider.parseWebhook("{}", headers());
    expect(event).toMatchObject({ periodStartEpoch: 1782864000, customerName: "", customerEmail: "" });
  });

  it("ignores the $0 subscription_create invoice", async () => {
    arrive({ type: "invoice.payment_succeeded", data: { object: cycleInvoice({ billing_reason: "subscription_create", amount_paid: 0 }) } });
    const parsed = await stripeProvider.parseWebhook("{}", headers());
    expect(parsed.event).toBeNull();
    expect(parsed.ignoredReason).toBe("billing_reason:subscription_create");
  });

  it("ignores a $0 cycle invoice", async () => {
    arrive({ type: "invoice.payment_succeeded", data: { object: cycleInvoice({ amount_paid: 0 }) } });
    const parsed = await stripeProvider.parseWebhook("{}", headers());
    expect(parsed.event).toBeNull();
    expect(parsed.ignoredReason).toBe("zero_amount");
  });

  it("ignores an invoice with no subscription id", async () => {
    arrive({ type: "invoice.payment_succeeded", data: { object: cycleInvoice({ parent: null }) } });
    const parsed = await stripeProvider.parseWebhook("{}", headers());
    expect(parsed.event).toBeNull();
    expect(parsed.ignoredReason).toBe("missing_ids");
  });

  it("invoice.payment_failed becomes renewal_failed carrying the invoice metadata", async () => {
    arrive({ type: "invoice.payment_failed", data: { object: { id: "in_2", customer: "cus_1", metadata: { flow: "option_c" } } } });
    const { event } = await stripeProvider.parseWebhook("{}", headers());
    expect(event).toMatchObject({ type: "renewal_failed", providerRef: "in_2", customerRef: "cus_1", metadata: { flow: "option_c" } });
  });

  it("invoice.payment_failed without a string customer is ignored", async () => {
    arrive({ type: "invoice.payment_failed", data: { object: { id: "in_2", customer: null } } });
    expect((await stripeProvider.parseWebhook("{}", headers())).event).toBeNull();
  });

  it("customer.subscription.updated with status canceled or unpaid becomes subscription_cancelled", async () => {
    for (const status of ["canceled", "unpaid"]) {
      arrive({ type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", status, metadata: { flow: "option_c" } } } });
      const { event } = await stripeProvider.parseWebhook("{}", headers());
      expect(event).toMatchObject({ type: "subscription_cancelled", subscriptionRef: "sub_1", customerRef: "cus_1", status });
    }
  });

  it("customer.subscription.updated with another status becomes subscription_updated", async () => {
    arrive({ type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", status: "active", metadata: {} } } });
    const { event } = await stripeProvider.parseWebhook("{}", headers());
    expect(event).toMatchObject({ type: "subscription_updated", status: "active" });
  });

  it("customer.subscription.deleted becomes subscription_cancelled", async () => {
    arrive({ type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1", status: "canceled", metadata: { flow: "option_c" } } } });
    const { event } = await stripeProvider.parseWebhook("{}", headers());
    expect(event).toMatchObject({ type: "subscription_cancelled", provider: "stripe", metadata: { flow: "option_c" } });
  });

  it("unhandled event types are ignored", async () => {
    arrive({ type: "charge.refunded", data: { object: {} } });
    const parsed = await stripeProvider.parseWebhook("{}", headers());
    expect(parsed).toMatchObject({ eventType: "charge.refunded", event: null, ignoredReason: "unhandled_type" });
  });
});
