import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPricesList = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn(function () {
    return { prices: { list: mockPricesList } };
  }),
}));

import { invalidateRenewalPriceCache, resolveRenewalPrice } from "./stripe-products";

describe("resolveRenewalPrice", () => {
  beforeEach(() => {
    invalidateRenewalPriceCache();
    mockPricesList.mockReset();
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  });

  afterEach(() => {
    delete process.env.STRIPE_PRODUCT_PM_RENEWAL;
    delete process.env.STRIPE_PRODUCT_AM_RENEWAL;
  });

  it("returns price config when Stripe returns active NZD price", async () => {
    process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";
    mockPricesList.mockResolvedValueOnce({
      data: [{ id: "price_pm_150", currency: "nzd", unit_amount: 15000, active: true, lookup_keys: ["pm_renewal_nzd"] }],
    });

    const result = await resolveRenewalPrice("pm_renewal_nzd");
    expect(result).toEqual({ priceId: "price_pm_150", currency: "nzd", unitAmount: 15000 });
  });

  it("throws MISSING_CONFIG when STRIPE_PRODUCT_PM_RENEWAL env var missing", async () => {
    await expect(resolveRenewalPrice("pm_renewal_nzd")).rejects.toThrow(/MISSING_CONFIG/);
  });

  it("throws PRICE_INACTIVE when no active prices found for lookup_key", async () => {
    process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";
    mockPricesList.mockResolvedValueOnce({ data: [] });
    await expect(resolveRenewalPrice("pm_renewal_nzd")).rejects.toThrow(/PRICE_INACTIVE/);
  });

  it("throws when price currency is not NZD", async () => {
    process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";
    mockPricesList.mockResolvedValueOnce({
      data: [{ id: "price_pm_150", currency: "usd", unit_amount: 15000, active: true, lookup_keys: ["pm_renewal_nzd"] }],
    });
    await expect(resolveRenewalPrice("pm_renewal_nzd")).rejects.toThrow(/currency/);
  });

  it("throws when unit_amount is null", async () => {
    process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";
    mockPricesList.mockResolvedValueOnce({
      data: [{ id: "price_pm_150", currency: "nzd", unit_amount: null, active: true, lookup_keys: ["pm_renewal_nzd"] }],
    });
    await expect(resolveRenewalPrice("pm_renewal_nzd")).rejects.toThrow(/unit_amount/);
  });

  it("caches the resolved price for subsequent calls within TTL", async () => {
    process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";
    mockPricesList.mockResolvedValue({
      data: [{ id: "price_pm_150", currency: "nzd", unit_amount: 15000, active: true, lookup_keys: ["pm_renewal_nzd"] }],
    });

    await resolveRenewalPrice("pm_renewal_nzd");
    await resolveRenewalPrice("pm_renewal_nzd");
    expect(mockPricesList).toHaveBeenCalledTimes(1);
  });

  it("uses correct product env var for AM lookup_key", async () => {
    process.env.STRIPE_PRODUCT_AM_RENEWAL = "prod_am";
    mockPricesList.mockResolvedValueOnce({
      data: [{ id: "price_am_75", currency: "nzd", unit_amount: 7500, active: true, lookup_keys: ["am_renewal_nzd"] }],
    });

    const result = await resolveRenewalPrice("am_renewal_nzd");
    expect(result.priceId).toBe("price_am_75");
    expect(mockPricesList).toHaveBeenCalledWith(expect.objectContaining({ product: "prod_am" }));
  });

  it("invalidateRenewalPriceCache clears the cache", async () => {
    process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";
    mockPricesList.mockResolvedValue({
      data: [{ id: "price_pm_150", currency: "nzd", unit_amount: 15000, active: true, lookup_keys: ["pm_renewal_nzd"] }],
    });

    await resolveRenewalPrice("pm_renewal_nzd");
    invalidateRenewalPriceCache();
    await resolveRenewalPrice("pm_renewal_nzd");
    expect(mockPricesList).toHaveBeenCalledTimes(2);
  });
});