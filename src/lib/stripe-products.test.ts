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
    delete process.env.STRIPE_PRICE_PROFESSIONAL;
    delete process.env.STRIPE_PRICE_ASSOCIATE;
  });

  it("returns price config when Stripe returns active NZD price", async () => {
    process.env.STRIPE_PRICE_PROFESSIONAL = "price_1TTFkhCi50x7UA8b51G5y4TQ";
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_1TTFkhCi50x7UA8b51G5y4TQ",
      currency: "nzd",
      unit_amount: 15000,
      active: true,
    });

    const result = await resolveRenewalPrice("pm_renewal_nzd");
    expect(result).toEqual({ priceId: "price_1TTFkhCi50x7UA8b51G5y4TQ", currency: "nzd", unitAmount: 15000 });
    expect(mockPricesRetrieve).toHaveBeenCalledWith("price_1TTFkhCi50x7UA8b51G5y4TQ");
  });

  it("throws MISSING_CONFIG when STRIPE_PRICE_PROFESSIONAL env var missing", async () => {
    await expect(resolveRenewalPrice("pm_renewal_nzd")).rejects.toThrow(/MISSING_CONFIG/);
  });

  it("throws PRICE_INACTIVE when price is not active", async () => {
    process.env.STRIPE_PRICE_PROFESSIONAL = "price_xxx";
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_xxx", currency: "nzd", unit_amount: 15000, active: false,
    });
    await expect(resolveRenewalPrice("pm_renewal_nzd")).rejects.toThrow(/PRICE_INACTIVE/);
  });

  it("throws PRICE_RETRIEVE_FAILED when Stripe throws on retrieve", async () => {
    process.env.STRIPE_PRICE_PROFESSIONAL = "price_missing";
    mockPricesRetrieve.mockRejectedValueOnce(new Error("No such price"));
    await expect(resolveRenewalPrice("pm_renewal_nzd")).rejects.toThrow(/PRICE_RETRIEVE_FAILED/);
  });

  it("throws INVALID_CURRENCY when price currency is not NZD", async () => {
    process.env.STRIPE_PRICE_PROFESSIONAL = "price_usd";
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_usd", currency: "usd", unit_amount: 15000, active: true,
    });
    await expect(resolveRenewalPrice("pm_renewal_nzd")).rejects.toThrow(/INVALID_CURRENCY/);
  });

  it("throws INVALID_UNIT_AMOUNT when unit_amount is null", async () => {
    process.env.STRIPE_PRICE_PROFESSIONAL = "price_zero";
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_zero", currency: "nzd", unit_amount: null, active: true,
    });
    await expect(resolveRenewalPrice("pm_renewal_nzd")).rejects.toThrow(/INVALID_UNIT_AMOUNT/);
  });

  it("caches the resolved price for subsequent calls within TTL", async () => {
    process.env.STRIPE_PRICE_PROFESSIONAL = "price_pm";
    mockPricesRetrieve.mockResolvedValue({
      id: "price_pm", currency: "nzd", unit_amount: 15000, active: true,
    });

    await resolveRenewalPrice("pm_renewal_nzd");
    await resolveRenewalPrice("pm_renewal_nzd");
    expect(mockPricesRetrieve).toHaveBeenCalledTimes(1);
  });

  it("uses STRIPE_PRICE_ASSOCIATE for AM lookup_key", async () => {
    process.env.STRIPE_PRICE_ASSOCIATE = "price_1TTFjrCi50x7UA8b6rursmWq";
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_1TTFjrCi50x7UA8b6rursmWq", currency: "nzd", unit_amount: 7500, active: true,
    });

    const result = await resolveRenewalPrice("am_renewal_nzd");
    expect(result.priceId).toBe("price_1TTFjrCi50x7UA8b6rursmWq");
    expect(mockPricesRetrieve).toHaveBeenCalledWith("price_1TTFjrCi50x7UA8b6rursmWq");
  });

  it("invalidateRenewalPriceCache clears the cache", async () => {
    process.env.STRIPE_PRICE_PROFESSIONAL = "price_pm";
    mockPricesRetrieve.mockResolvedValue({
      id: "price_pm", currency: "nzd", unit_amount: 15000, active: true,
    });

    await resolveRenewalPrice("pm_renewal_nzd");
    invalidateRenewalPriceCache();
    await resolveRenewalPrice("pm_renewal_nzd");
    expect(mockPricesRetrieve).toHaveBeenCalledTimes(2);
  });
});

describe("resolveRenewalPriceByTier (Phase D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateRenewalPriceCache();
    process.env.STRIPE_PRICE_PROFESSIONAL_RENEWAL = "price_pm_150";
    process.env.STRIPE_PRICE_ASSOCIATE_RENEWAL = "price_am_75";
  });

  it("reads STRIPE_PRICE_PROFESSIONAL for tier=professional", async () => {
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_pm_150", currency: "nzd", unit_amount: 15000, active: true,
    });
    const result = await resolveRenewalPriceByTier("professional");
    expect(result.priceId).toBe("price_pm_150");
    expect(result.unitAmount).toBe(15000);
    expect(mockPricesRetrieve).toHaveBeenCalledWith("price_pm_150");
  });

  it("reads STRIPE_PRICE_ASSOCIATE for tier=associate", async () => {
    mockPricesRetrieve.mockResolvedValueOnce({
      id: "price_am_75", currency: "nzd", unit_amount: 7500, active: true,
    });
    const result = await resolveRenewalPriceByTier("associate");
    expect(result.priceId).toBe("price_am_75");
    expect(result.unitAmount).toBe(7500);
  });

  it("throws MISSING_CONFIG for unknown tier", async () => {
    await expect(resolveRenewalPriceByTier("student")).rejects.toThrow(/MISSING_CONFIG: unknown tier/);
  });

  it("throws MISSING_CONFIG when the tier's renewalPriceEnvVar is unset", async () => {
    delete process.env.STRIPE_PRICE_ASSOCIATE_RENEWAL;
    await expect(resolveRenewalPriceByTier("associate")).rejects.toThrow(/MISSING_CONFIG: STRIPE_PRICE_ASSOCIATE_RENEWAL/);
  });
});