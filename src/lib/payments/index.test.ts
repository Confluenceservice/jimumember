import { afterEach, describe, expect, it } from "vitest";
import { getPaymentProvider, PaymentConfigError } from "./index";

describe("getPaymentProvider", () => {
  const original = process.env.PAYMENT_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = original;
  });

  it("defaults to stripe when PAYMENT_PROVIDER is unset", () => {
    delete process.env.PAYMENT_PROVIDER;
    expect(getPaymentProvider().id).toBe("stripe");
  });

  it("accepts ' Stripe ' (trim, case-insensitive)", () => {
    process.env.PAYMENT_PROVIDER = " Stripe ";
    expect(getPaymentProvider().id).toBe("stripe");
  });

  it("treats an empty value as the default", () => {
    process.env.PAYMENT_PROVIDER = "";
    expect(getPaymentProvider().id).toBe("stripe");
  });

  it("rejects airwallex until the adapter ships", () => {
    process.env.PAYMENT_PROVIDER = "airwallex";
    expect(() => getPaymentProvider()).toThrow(PaymentConfigError);
    expect(() => getPaymentProvider()).toThrow("PAYMENT_PROVIDER=airwallex is not available in this build");
  });

  it("rejects an unknown value", () => {
    process.env.PAYMENT_PROVIDER = "paypal";
    expect(() => getPaymentProvider()).toThrow('Unknown PAYMENT_PROVIDER "paypal" (expected stripe|airwallex)');
  });
});
