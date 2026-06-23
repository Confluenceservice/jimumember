import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockResolveRenewalPrice,
  mockAppendRenewal,
  mockStripeSessionsCreate,
  mockGetSiteBaseUrl,
  mockIsCheckoutDryRunEnabled,
  mockIsStripeRetryableError,
} = vi.hoisted(() => ({
  mockResolveRenewalPrice: vi.fn(),
  mockAppendRenewal: vi.fn(),
  mockStripeSessionsCreate: vi.fn(),
  mockGetSiteBaseUrl: vi.fn(() => "https://test.example.com"),
  mockIsCheckoutDryRunEnabled: vi.fn(() => false),
  mockIsStripeRetryableError: vi.fn(() => false),
}));

vi.mock("../../../lib/stripe-products", () => ({
  resolveRenewalPrice: mockResolveRenewalPrice,
  invalidateRenewalPriceCache: vi.fn(),
}));
vi.mock("../../../lib/renewal-sheet", () => ({
  appendRenewal: mockAppendRenewal,
  markRenewalPaid: vi.fn(),
  getRenewalBySession: vi.fn(),
}));
vi.mock("../../../lib/stripe-checkout", () => ({
  getSiteBaseUrl: mockGetSiteBaseUrl,
  isCheckoutDryRunEnabled: mockIsCheckoutDryRunEnabled,
  isStripeRetryableError: mockIsStripeRetryableError,
}));
vi.mock("stripe", () => ({
  default: vi.fn(function () {
    return { checkout: { sessions: { create: mockStripeSessionsCreate } } };
  }),
}));

process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_PRODUCT_AM_RENEWAL = "prod_am";

import { POST } from "./checkout-am";

const VALID_BODY = { firstName: "Bob", lastName: "Doe", email: "bob@example.com", year: 2026 };

async function call(body: unknown) {
  const request = new Request("https://test.example.com/api/renew/checkout-am", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST({ request } as any);
}

describe("checkout-am", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCheckoutDryRunEnabled.mockReturnValue(false);
    mockResolveRenewalPrice.mockResolvedValue({ priceId: "price_am_75", currency: "nzd", unitAmount: 7500 });
    mockAppendRenewal.mockResolvedValue(undefined);
    mockStripeSessionsCreate.mockResolvedValue({ id: "cs_am_1", url: "https://stripe.com/c/cs_am_1" });
  });

  it("happy path: creates Stripe session with am_renewal_nzd lookup", async () => {
    const response = await call(VALID_BODY);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.url).toBe("https://stripe.com/c/cs_am_1");

    expect(mockResolveRenewalPrice).toHaveBeenCalledWith("am_renewal_nzd");
    expect(mockAppendRenewal).toHaveBeenCalledWith(expect.objectContaining({
      tier: "am", phone: "", pdEntries: [], amountCents: 7500, paymentStatus: "pending",
    }));
    expect(mockStripeSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ quantity: 1, price: "price_am_75" }],
        metadata: expect.objectContaining({ flow: "renewal", tier: "am", pd_entries: "", amount_cents: "7500" }),
      }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^renewal:am:/) }),
    );
  });

  it("returns 400 on missing fields", async () => {
    expect((await call({ firstName: "", lastName: "Doe", email: "bob@example.com", year: 2026 })).status).toBe(400);
    expect((await call({ firstName: "Bob", lastName: "", email: "bob@example.com", year: 2026 })).status).toBe(400);
    expect((await call({ firstName: "Bob", lastName: "Doe", email: "", year: 2026 })).status).toBe(400);
  });

  it("returns 400 on invalid email", async () => {
    expect((await call({ ...VALID_BODY, email: "not-an-email" })).status).toBe(400);
  });

  it("returns 500 MISSING_CONFIG when STRIPE_PRODUCT_AM_RENEWAL missing", async () => {
    mockResolveRenewalPrice.mockRejectedValueOnce(new Error("MISSING_CONFIG: STRIPE_PRODUCT_AM_RENEWAL not set"));
    const response = await call(VALID_BODY);
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("MISSING_CONFIG");
  });

  it("dry-run returns { dryRun: true } without creating session", async () => {
    mockIsCheckoutDryRunEnabled.mockReturnValue(true);
    const response = await call(VALID_BODY);
    const json = await response.json();
    expect(json.dryRun).toBe(true);
    expect(mockStripeSessionsCreate).not.toHaveBeenCalled();
    expect(mockAppendRenewal).not.toHaveBeenCalled();
  });

  it("returns 500 CHECKOUT_ERROR on Stripe error", async () => {
    mockStripeSessionsCreate.mockRejectedValueOnce(new Error("stripe failed"));
    const response = await call(VALID_BODY);
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("CHECKOUT_ERROR");
  });

  it("returns 500 with code SHEET_WRITE_FAILED when appendRenewal throws", async () => {
    mockAppendRenewal.mockRejectedValueOnce(new Error("OAuth token fetch failed"));

    const response = await call(VALID_BODY);
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("SHEET_WRITE_FAILED");
    expect(mockStripeSessionsCreate).not.toHaveBeenCalled();
  });
});
