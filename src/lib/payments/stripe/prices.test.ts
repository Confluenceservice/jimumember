import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPricesRetrieve = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn(function () {
    return { prices: { retrieve: mockPricesRetrieve } };
  }),
}));

import { invalidateStripePriceCache, resolveStripePrice } from "./prices";
import { resetStripeClientForTests } from "./client";

describe("resolveStripePrice (renewal)", () => {
  beforeEach(() => {
    invalidateStripePriceCache();
    resetStripeClientForTests();
    mockPricesRetrieve.mockReset();
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  });

  afterEach(() => {
    delete process.env.STRIPE_PRICE_1;
    delete process.env.STRIPE_PRICE_2;
    delete process.env.STRIPE_PRICE_1_RENEWAL;
    delete process.env.STRIPE_PRICE_2_RENEWAL;
  });

  it("returns price config when Stripe returns an active matching-currency price", async () => {
    process.env.STRIPE_PRICE_2_RENEWAL = "price_1TTFkhCi50x7UA8b51G5y4TQ";
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_1TTFkhCi50x7UA8b51G5y4TQ",
      currency: "usd",
      unit_amount: 15000,
      active: true,
    });

    const result = await resolveStripePrice("advanced", "renewal");
    expect(result).toEqual({ priceRef: "price_1TTFkhCi50x7UA8b51G5y4TQ", currency: "usd", unitAmount: 15000 });
    expect(mockPricesRetrieve).toHaveBeenCalledWith("price_1TTFkhCi50x7UA8b51G5y4TQ");
  });

  it("throws MISSING_CONFIG when the renewal env var is missing", async () => {
    await expect(resolveStripePrice("advanced", "renewal")).rejects.toThrow(/MISSING_CONFIG: STRIPE_PRICE_2_RENEWAL not set/);
  });

  it("throws MISSING_CONFIG for an unknown tier", async () => {
    await expect(resolveStripePrice("student", "renewal")).rejects.toThrow(/MISSING_CONFIG: unknown tier student/);
  });

  it("throws PRICE_INACTIVE when price is not active", async () => {
    process.env.STRIPE_PRICE_2_RENEWAL = "price_xxx";
    mockPricesRetrieve.mockResolvedValueOnce({ id: "price_xxx", currency: "usd", unit_amount: 15000, active: false });
    await expect(resolveStripePrice("advanced", "renewal")).rejects.toThrow(/PRICE_INACTIVE/);
  });

  it("throws PRICE_RETRIEVE_FAILED when Stripe throws on retrieve", async () => {
    process.env.STRIPE_PRICE_2_RENEWAL = "price_missing";
    mockPricesRetrieve.mockRejectedValueOnce(new Error("No such price"));
    await expect(resolveStripePrice("advanced", "renewal")).rejects.toThrow(/PRICE_RETRIEVE_FAILED: No such price \(priceId=price_missing\)/);
  });

  it("throws INVALID_CURRENCY when price currency doesn't match config", async () => {
    process.env.STRIPE_PRICE_2_RENEWAL = "price_eur";
    mockPricesRetrieve.mockResolvedValueOnce({ id: "price_eur", currency: "eur", unit_amount: 15000, active: true });
    await expect(resolveStripePrice("advanced", "renewal")).rejects.toThrow(/INVALID_CURRENCY/);
  });

  it("throws INVALID_UNIT_AMOUNT when unit_amount is null", async () => {
    process.env.STRIPE_PRICE_2_RENEWAL = "price_zero";
    mockPricesRetrieve.mockResolvedValueOnce({ id: "price_zero", currency: "usd", unit_amount: null, active: true });
    await expect(resolveStripePrice("advanced", "renewal")).rejects.toThrow(/INVALID_UNIT_AMOUNT/);
  });

  it("caches the resolved price within the TTL", async () => {
    process.env.STRIPE_PRICE_2_RENEWAL = "price_pm";
    mockPricesRetrieve.mockResolvedValue({ id: "price_pm", currency: "usd", unit_amount: 15000, active: true });
    await resolveStripePrice("advanced", "renewal");
    await resolveStripePrice("advanced", "renewal");
    expect(mockPricesRetrieve).toHaveBeenCalledTimes(1);
  });

  it("invalidateStripePriceCache clears the cache", async () => {
    process.env.STRIPE_PRICE_2_RENEWAL = "price_pm";
    mockPricesRetrieve.mockResolvedValue({ id: "price_pm", currency: "usd", unit_amount: 15000, active: true });
    await resolveStripePrice("advanced", "renewal");
    invalidateStripePriceCache();
    await resolveStripePrice("advanced", "renewal");
    expect(mockPricesRetrieve).toHaveBeenCalledTimes(2);
  });

  it("reads STRIPE_PRICE_1_RENEWAL for tier=basic", async () => {
    process.env.STRIPE_PRICE_1_RENEWAL = "price_am_75";
    mockPricesRetrieve.mockResolvedValueOnce({ id: "price_am_75", currency: "usd", unit_amount: 7500, active: true });
    const result = await resolveStripePrice("basic", "renewal");
    expect(result.priceRef).toBe("price_am_75");
    expect(result.unitAmount).toBe(7500);
  });
});

describe("resolveStripePrice (application)", () => {
  beforeEach(() => {
    invalidateStripePriceCache();
    resetStripeClientForTests();
    mockPricesRetrieve.mockReset();
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    process.env.STRIPE_PRICE_1 = "price_basic_app";
    process.env.STRIPE_PRICE_1_RENEWAL = "price_basic_renew";
  });

  afterEach(() => {
    delete process.env.STRIPE_PRICE_1;
    delete process.env.STRIPE_PRICE_1_RENEWAL;
  });

  it("reads STRIPE_PRICE_1 for basic", async () => {
    mockPricesRetrieve.mockResolvedValueOnce({ id: "price_basic_app", currency: "usd", unit_amount: 7500, active: true });
    const result = await resolveStripePrice("basic", "application");
    expect(result.priceRef).toBe("price_basic_app");
    expect(mockPricesRetrieve).toHaveBeenCalledWith("price_basic_app");
  });

  it("caches per kind: application and renewal of one tier resolve separately", async () => {
    mockPricesRetrieve.mockImplementation(async (id: string) => ({ id, currency: "usd", unit_amount: 7500, active: true }));
    const app = await resolveStripePrice("basic", "application");
    const renew = await resolveStripePrice("basic", "renewal");
    expect(app.priceRef).toBe("price_basic_app");
    expect(renew.priceRef).toBe("price_basic_renew");
    expect(mockPricesRetrieve).toHaveBeenCalledTimes(2);
  });
});
