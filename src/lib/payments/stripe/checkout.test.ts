import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  sessionsRetrieve: vi.fn(),
  subscriptionsCreate: vi.fn(),
  paymentIntentsRetrieve: vi.fn(),
  paymentMethodsAttach: vi.fn(),
  customersUpdate: vi.fn(),
}));

vi.mock("stripe", () => {
  const Ctor: any = vi.fn(function () {
    return {
      checkout: { sessions: { create: m.sessionsCreate, retrieve: m.sessionsRetrieve } },
      subscriptions: { create: m.subscriptionsCreate },
      paymentIntents: { retrieve: m.paymentIntentsRetrieve },
      paymentMethods: { attach: m.paymentMethodsAttach },
      customers: { update: m.customersUpdate },
    };
  });
  Ctor.errors = { StripeError: class extends Error {} };
  return { default: Ctor };
});

import { stripeProvider } from "./index";
import { resetStripeClientForTests } from "./client";
import { CHECKOUT_REF_PLACEHOLDER, type CheckoutInput } from "../types";

const baseInput: CheckoutInput = {
  mode: "first_term_then_annual",
  lineItem: { kind: "amount", amount: 4588, currency: "usd", name: "Basic Membership", description: "Then $100.00 per year." },
  customerEmail: "a@b.test",
  clientReference: "a@b.test",
  metadata: { flow: "option_c", plan: "basic" },
  successUrl: `https://app.test/success?session_id=${CHECKOUT_REF_PLACEHOLDER}`,
  cancelUrl: "https://app.test/cancel",
  submitMessage: "Then $100.00 per year.",
  idempotencyKey: "checkout:basic:a@b.test:4588",
};

describe("stripe adapter createCheckout / getCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStripeClientForTests();
    process.env.STRIPE_SECRET_KEY = "sk_test";
    m.sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" });
  });

  it("amount line item maps to price_data and returns checkoutRef + redirectUrl", async () => {
    const result = await stripeProvider.createCheckout(baseInput);
    expect(result).toEqual({ checkoutRef: "cs_1", redirectUrl: "https://stripe.test/cs_1" });
    const [params, opts] = m.sessionsCreate.mock.calls[0];
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: 4588,
          product_data: { name: "Basic Membership", description: "Then $100.00 per year." },
        },
      },
    ]);
    expect(params.metadata).toEqual({ flow: "option_c", plan: "basic" });
    expect(params.client_reference_id).toBe("a@b.test");
    expect(params.custom_text).toEqual({ submit: { message: "Then $100.00 per year." } });
    expect(params.payment_intent_data).toEqual({ setup_future_usage: "off_session", receipt_email: "a@b.test" });
    expect(params.cancel_url).toBe("https://app.test/cancel");
    expect(opts).toEqual({ idempotencyKey: "checkout:basic:a@b.test:4588" });
  });

  it("price line item maps to price", async () => {
    await stripeProvider.createCheckout({
      ...baseInput,
      mode: "one_time",
      lineItem: { kind: "price", priceRef: "price_renew" },
      submitMessage: undefined,
    });
    const [params] = m.sessionsCreate.mock.calls[0];
    expect(params.line_items).toEqual([{ quantity: 1, price: "price_renew" }]);
  });

  it("success url placeholder becomes {CHECKOUT_SESSION_ID}", async () => {
    await stripeProvider.createCheckout(baseInput);
    const [params] = m.sessionsCreate.mock.calls[0];
    expect(params.success_url).toBe("https://app.test/success?session_id={CHECKOUT_SESSION_ID}");
  });

  it("new customer: customer_creation always + customer_email", async () => {
    await stripeProvider.createCheckout(baseInput);
    const [params] = m.sessionsCreate.mock.calls[0];
    expect(params.customer_creation).toBe("always");
    expect(params.customer_email).toBe("a@b.test");
    expect(params.customer).toBeUndefined();
  });

  it("existing customerRef sets customer and omits customer_creation / customer_email", async () => {
    await stripeProvider.createCheckout({ ...baseInput, customerRef: "cus_9" });
    const [params] = m.sessionsCreate.mock.calls[0];
    expect(params.customer).toBe("cus_9");
    expect(params.customer_creation).toBeUndefined();
    expect(params.customer_email).toBeUndefined();
  });

  it("no submitMessage means no custom_text", async () => {
    await stripeProvider.createCheckout({ ...baseInput, submitMessage: undefined });
    const [params] = m.sessionsCreate.mock.calls[0];
    expect(params.custom_text).toBeUndefined();
  });

  it("getCheckout maps a session to a summary", async () => {
    m.sessionsRetrieve.mockResolvedValue({
      id: "cs_1",
      metadata: { plan: "basic" },
      customer_email: "a@b.test",
      amount_total: 4588,
      customer: "cus_1",
    });
    expect(await stripeProvider.getCheckout("cs_1")).toEqual({
      checkoutRef: "cs_1",
      metadata: { plan: "basic" },
      customerEmail: "a@b.test",
      amountTotal: 4588,
      customerRef: "cus_1",
    });
    expect(m.sessionsRetrieve).toHaveBeenCalledWith("cs_1", { expand: ["line_items"] });
  });

  it("getCheckout reads customerRef from an expanded customer and tolerates nulls", async () => {
    m.sessionsRetrieve.mockResolvedValue({ id: "cs_2", metadata: null, customer: { id: "cus_2" } });
    expect(await stripeProvider.getCheckout("cs_2")).toEqual({
      checkoutRef: "cs_2",
      metadata: {},
      customerEmail: null,
      amountTotal: null,
      customerRef: "cus_2",
    });
  });

  it("getCheckout propagates Stripe errors", async () => {
    m.sessionsRetrieve.mockRejectedValue(new Error("No such session"));
    await expect(stripeProvider.getCheckout("cs_x")).rejects.toThrow("No such session");
  });
});

describe("stripe adapter ensureSubscription", () => {
  const input = {
    checkoutRef: "cs_1",
    customerRef: "cus_1",
    paymentRef: "pi_1",
    priceRef: "price_annual",
    anchorEpoch: 1782864000,
    plan: "basic",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetStripeClientForTests();
    process.env.STRIPE_SECRET_KEY = "sk_test";
    m.paymentIntentsRetrieve.mockResolvedValue({ payment_method: "pm_1" });
    m.paymentMethodsAttach.mockResolvedValue({});
    m.customersUpdate.mockResolvedValue({});
    m.subscriptionsCreate.mockResolvedValue({ id: "sub_1" });
  });

  it("creates a trialing subscription with the option_c idempotency key and attaches the saved card", async () => {
    expect(await stripeProvider.ensureSubscription(input)).toEqual({ subscriptionRef: "sub_1" });
    expect(m.paymentMethodsAttach).toHaveBeenCalledWith("pm_1", { customer: "cus_1" });
    expect(m.customersUpdate).toHaveBeenCalledWith("cus_1", { invoice_settings: { default_payment_method: "pm_1" } });
    expect(m.subscriptionsCreate).toHaveBeenCalledWith(
      {
        customer: "cus_1",
        items: [{ price: "price_annual" }],
        trial_end: 1782864000,
        metadata: { flow: "option_c", plan: "basic", checkout_session_id: "cs_1" },
        expand: ["default_payment_method"],
        default_payment_method: "pm_1",
      },
      { idempotencyKey: "option_c_sub_cs_1" },
    );
  });

  it("still creates the subscription when the PaymentIntent retrieve fails (no default_payment_method)", async () => {
    m.paymentIntentsRetrieve.mockRejectedValue(new Error("pi gone"));
    await stripeProvider.ensureSubscription(input);
    const [params] = m.subscriptionsCreate.mock.calls[0];
    expect(params.default_payment_method).toBeUndefined();
    expect(m.paymentMethodsAttach).not.toHaveBeenCalled();
  });

  it("still creates the subscription when attaching the payment method fails", async () => {
    m.paymentMethodsAttach.mockRejectedValue(new Error("already attached"));
    await stripeProvider.ensureSubscription(input);
    const [params] = m.subscriptionsCreate.mock.calls[0];
    expect(params.default_payment_method).toBeUndefined();
  });

  it("skips the PaymentIntent lookup when there is no paymentRef", async () => {
    await stripeProvider.ensureSubscription({ ...input, paymentRef: null });
    expect(m.paymentIntentsRetrieve).not.toHaveBeenCalled();
    expect(m.subscriptionsCreate).toHaveBeenCalledTimes(1);
  });

  it("propagates subscription create failures", async () => {
    m.subscriptionsCreate.mockRejectedValue(new Error("stripe down"));
    await expect(stripeProvider.ensureSubscription(input)).rejects.toThrow("stripe down");
  });
});
