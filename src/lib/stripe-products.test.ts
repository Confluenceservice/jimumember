import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPricesRetrieve = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn(function () {
    return {
      prices: { retrieve: mockPricesRetrieve },
    };
  }),
}));

import { invalidateRenewalPriceCache, resolveRenewalPrice, resolveRenewalPriceByTier } from "./stripe-products";

describe("resolveRenewalPrice", () => {
  beforeEach(() => {
    invalidateRenewalPriceCache();
    mockPricesRetrieve.mockReset();
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  });

  afterEach(() => {
    delete process.env.STRIPE_PRICE_ADVANCED;
    delete process.env.STRIPE_PRICE_BASIC;
    delete process.env.STRIPE_PRICE_ADVANCED_RENEWAL;
    delete process.env.STRIPE_PRICE_BASIC_RENEWAL;
  });

  it("returns price config when Stripe returns active NZD price", async () => {
    process.env.STRIPE_PRICE_ADVANCED_RENEWAL = "price_1TTFkhCi50x7UA8b51G5y4TQ";
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_1TTFkhCi50x7UA8b51G5y4TQ",
      currency: "nzd",
      unit_amount: 15000,
      active: true,
    });

    const result = await resolveRenewalPrice("adv_renewal_nzd");
    expect(result).toEqual({ priceId: "price_1TTFkhCi50x7UA8b51G5y4TQ", currency: "nzd", unitAmount: 15000 });
    expect(mockPricesRetrieve).toHaveBeenCalledWith("price_1TTFkhCi50x7UA8b51G5y4TQ");
  });

  it("throws MISSING_CONFIG when STRIPE_PRICE_ADVANCED_RENEWAL env var missing", async () => {
    await expect(resolveRenewalPrice("adv_renewal_nzd")).rejects.toThrow(/MISSING_CONFIG/);
  });

  it("throws PRICE_INACTIVE when price is not active", async () => {
    process.env.STRIPE_PRICE_ADVANCED_RENEWAL = "price_xxx";
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_xxx", currency: "nzd", unit_amount: 15000, active: false,
    });
    await expect(resolveRenewalPrice("adv_renewal_nzd")).rejects.toThrow(/PRICE_INACTIVE/);
  });

  it("throws PRICE_RETRIEVE_FAILED when Stripe throws on retrieve", async () => {
    process.env.STRIPE_PRICE_ADVANCED_RENEWAL = "price_missing";
    mockPricesRetrieve.mockRejectedValueOnce(new Error("No such price"));
    await expect(resolveRenewalPrice("adv_renewal_nzd")).rejects.toThrow(/PRICE_RETRIEVE_FAILED/);
  });

  it("throws INVALID_CURRENCY when price currency is not NZD", async () => {
    process.env.STRIPE_PRICE_ADVANCED_RENEWAL = "price_usd";
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_usd", currency: "usd", unit_amount: 15000, active: true,
    });
    await expect(resolveRenewalPrice("adv_renewal_nzd")).rejects.toThrow(/INVALID_CURRENCY/);
  });

  it("throws INVALID_UNIT_AMOUNT when unit_amount is null", async () => {
    process.env.STRIPE_PRICE_ADVANCED_RENEWAL = "price_zero";
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_zero", currency: "nzd", unit_amount: null, active: true,
    });
    await expect(resolveRenewalPrice("adv_renewal_nzd")).rejects.toThrow(/INVALID_UNIT_AMOUNT/);
  });

  it("caches the resolved price for subsequent calls within TTL", async () => {
    process.env.STRIPE_PRICE_ADVANCED_RENEWAL = "price_pm";
    mockPricesRetrieve.mockResolvedValue({
      id: "price_pm", currency: "nzd", unit_amount: 15000, active: true,
    });

    await resolveRenewalPrice("adv_renewal_nzd");
    await resolveRenewalPrice("adv_renewal_nzd");
    expect(mockPricesRetrieve).toHaveBeenCalledTimes(1);
  });

  it("uses STRIPE_PRICE_BASIC_RENEWAL for Basic lookup_key", async () => {
    process.env.STRIPE_PRICE_BASIC_RENEWAL = "price_1TTFjrCi50x7UA8b6rursmWq";
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_1TTFjrCi50x7UA8b6rursmWq", currency: "nzd", unit_amount: 7500, active: true,
    });

    const result = await resolveRenewalPrice("basic_renewal_nzd");
    expect(result.priceId).toBe("price_1TTFjrCi50x7UA8b6rursmWq");
    expect(mockPricesRetrieve).toHaveBeenCalledWith("price_1TTFjrCi50x7UA8b6rursmWq");
  });

  it("invalidateRenewalPriceCache clears the cache", async () => {
    process.env.STRIPE_PRICE_ADVANCED_RENEWAL = "price_pm";
    mockPricesRetrieve.mockResolvedValue({
      id: "price_pm", currency: "nzd", unit_amount: 15000, active: true,
    });

    await resolveRenewalPrice("adv_renewal_nzd");
    invalidateRenewalPriceCache();
    await resolveRenewalPrice("adv_renewal_nzd");
    expect(mockPricesRetrieve).toHaveBeenCalledTimes(2);
  });
});

describe("resolveRenewalPriceByTier (Phase D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateRenewalPriceCache();
    process.env.STRIPE_PRICE_ADVANCED_RENEWAL = "price_pm_150";
    process.env.STRIPE_PRICE_BASIC_RENEWAL = "price_am_75";
  });

  it("reads STRIPE_PRICE_ADVANCED for tier=advanced", async () => {
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_pm_150", currency: "nzd", unit_amount: 15000, active: true,
    });
    const result = await resolveRenewalPriceByTier("advanced");
    expect(result.priceId).toBe("price_pm_150");
    expect(result.unitAmount).toBe(15000);
    expect(mockPricesRetrieve).toHaveBeenCalledWith("price_pm_150");
  });

  it("reads STRIPE_PRICE_BASIC for tier=basic", async () => {
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_am_75", currency: "nzd", unit_amount: 7500, active: true,
    });
    const result = await resolveRenewalPriceByTier("basic");
    expect(result.priceId).toBe("price_am_75");
    expect(result.unitAmount).toBe(7500);
  });

  it("throws MISSING_CONFIG for unknown tier", async () => {
    await expect(resolveRenewalPriceByTier("student")).rejects.toThrow(/MISSING_CONFIG: unknown tier/);
  });

  it("throws MISSING_CONFIG when the tier's renewalPriceEnvVar is unset", async () => {
    delete process.env.STRIPE_PRICE_BASIC_RENEWAL;
    await expect(resolveRenewalPriceByTier("basic")).rejects.toThrow(/MISSING_CONFIG: STRIPE_PRICE_BASIC_RENEWAL/);
  });
});