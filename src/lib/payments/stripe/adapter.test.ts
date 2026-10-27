import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  class FakeStripeError extends Error {}
  return {
    FakeStripeError,
    ctor: vi.fn(),
    customersList: vi.fn(),
    subscriptionsList: vi.fn(),
    productsList: vi.fn(),
  };
});

vi.mock("stripe", () => {
  const Ctor: any = vi.fn(function (this: unknown, ...args: unknown[]) {
    m.ctor(...args);
    return {
      customers: { list: m.customersList },
      subscriptions: { list: m.subscriptionsList },
      products: { list: m.productsList },
    };
  });
  Ctor.errors = { StripeError: m.FakeStripeError };
  return { default: Ctor };
});

import { stripeProvider } from "./index";
import { getStripeClient, resetStripeClientForTests } from "./client";
import { PaymentConfigError } from "../errors";

describe("stripe adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStripeClientForTests();
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  });

  it("creates the client with the pinned apiVersion, once per key", () => {
    getStripeClient();
    getStripeClient();
    expect(m.ctor).toHaveBeenCalledTimes(1);
    expect(m.ctor).toHaveBeenCalledWith("sk_test", { apiVersion: "2026-06-24.dahlia" });
  });

  it("throws MISSING_CONFIG when STRIPE_SECRET_KEY is unset", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => getStripeClient()).toThrow(PaymentConfigError);
    expect(() => getStripeClient()).toThrow("MISSING_CONFIG: STRIPE_SECRET_KEY");
  });

  it("findReturningCustomer returns null when no customer matches", async () => {
    m.customersList.mockResolvedValue({ data: [] });
    expect(await stripeProvider.findReturningCustomer("a@b.test")).toBeNull();
    expect(m.customersList).toHaveBeenCalledWith({ email: "a@b.test", limit: 1 });
  });

  it("findReturningCustomer reports hadSubscription from subscriptions.list", async () => {
    m.customersList.mockResolvedValue({ data: [{ id: "cus_1" }] });
    m.subscriptionsList.mockResolvedValueOnce({ data: [{ id: "sub_1" }] });
    expect(await stripeProvider.findReturningCustomer("a@b.test")).toEqual({
      customerRef: "cus_1",
      hadSubscription: true,
    });
    expect(m.subscriptionsList).toHaveBeenCalledWith({ customer: "cus_1", status: "all", limit: 1 });

    m.subscriptionsList.mockResolvedValueOnce({ data: [] });
    expect(await stripeProvider.findReturningCustomer("a@b.test")).toEqual({
      customerRef: "cus_1",
      hadSubscription: false,
    });
  });

  it("missingConfig lists unset env var names per scope", () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(stripeProvider.missingConfig("api")).toEqual(["STRIPE_SECRET_KEY"]);
    expect(stripeProvider.missingConfig("webhook")).toEqual(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
    process.env.STRIPE_SECRET_KEY = "sk_test";
    expect(stripeProvider.missingConfig("webhook")).toEqual(["STRIPE_WEBHOOK_SECRET"]);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    expect(stripeProvider.missingConfig("webhook")).toEqual([]);
  });

  it("healthCheck: connected, disconnected with message, not_configured", async () => {
    m.productsList.mockResolvedValueOnce({ data: [] });
    expect(await stripeProvider.healthCheck()).toEqual({ status: "connected" });
    expect(m.productsList).toHaveBeenCalledWith({ limit: 1 });

    m.productsList.mockRejectedValueOnce(new Error("bad key"));
    expect(await stripeProvider.healthCheck()).toEqual({ status: "disconnected", error: "bad key" });

    delete process.env.STRIPE_SECRET_KEY;
    expect(await stripeProvider.healthCheck()).toEqual({ status: "not_configured" });
  });

  it("isRetryableError is true only for Stripe connection and API errors", () => {
    const conn = Object.assign(new Error("x"), { name: "StripeConnectionError" });
    const api = Object.assign(new Error("x"), { name: "StripeAPIError" });
    expect(stripeProvider.isRetryableError(conn)).toBe(true);
    expect(stripeProvider.isRetryableError(api)).toBe(true);
    expect(stripeProvider.isRetryableError(new Error("x"))).toBe(false);
    expect(stripeProvider.isRetryableError("x")).toBe(false);
  });

  it("isRetryableError sees a retryable Stripe error wrapped as the cause", () => {
    const conn = Object.assign(new Error("x"), { name: "StripeConnectionError" });
    expect(stripeProvider.isRetryableError(new Error("PRICE_RETRIEVE_FAILED", { cause: conn }))).toBe(true);
    expect(stripeProvider.isRetryableError(new Error("PRICE_RETRIEVE_FAILED", { cause: new Error("y") }))).toBe(false);
  });

  it("userFacingError returns the message of Stripe errors only", () => {
    expect(stripeProvider.userFacingError(new m.FakeStripeError("declined"))).toBe("declined");
    expect(stripeProvider.userFacingError(new Error("boom"))).toBeNull();
  });
});
