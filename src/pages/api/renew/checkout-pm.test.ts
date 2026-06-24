import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  getRenewalById: vi.fn(),
}));

vi.mock("../../../lib/stripe-checkout", () => ({
  getSiteBaseUrl: mockGetSiteBaseUrl,
  isCheckoutDryRunEnabled: mockIsCheckoutDryRunEnabled,
  isStripeRetryableError: mockIsStripeRetryableError,
}));

vi.mock("stripe", () => ({
  default: vi.fn(function () {
    return {
      checkout: { sessions: { create: mockStripeSessionsCreate } },
    };
  }),
}));

process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";

import { POST } from "./checkout-pm";

const VALID_BODY = {
  firstName: "Alice", lastName: "Smith", email: "alice@example.com", phone: "021234567",
  year: 2026,
  pdEntries: [{ dateCompleted: "2026-01-15", activity: "Workshop", totalHours: 3, provider: "Hospice NZ" }],
};

async function call(body: unknown) {
  const request = new Request("https://test.example.com/api/renew/checkout-pm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST({ request } as any);
}

describe("checkout-pm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCheckoutDryRunEnabled.mockReturnValue(false);
    mockIsStripeRetryableError.mockReturnValue(false);
    mockResolveRenewalPrice.mockResolvedValue({ priceId: "price_pm_150", currency: "nzd", unitAmount: 15000 });
    mockAppendRenewal.mockResolvedValue(undefined);
    mockStripeSessionsCreate.mockResolvedValue({ id: "cs_pm_1", url: "https://stripe.com/c/cs_pm_1" });
  });

  afterEach(() => {
    delete process.env.STRIPE_PRODUCT_PM_RENEWAL;
  });

  it("happy path: resolves price, appends pending row, creates Stripe session", async () => {
    process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";
    const response = await call(VALID_BODY);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.url).toBe("https://stripe.com/c/cs_pm_1");
    expect(json.renewalId).toBeDefined();

    const appendOrder = mockAppendRenewal.mock.invocationCallOrder[0];
    const stripeOrder = mockStripeSessionsCreate.mock.invocationCallOrder[0];
    expect(appendOrder).toBeLessThan(stripeOrder);

    expect(mockAppendRenewal).toHaveBeenCalledWith(expect.objectContaining({
      tier: "pm", year: 2026, amountCents: 15000, paymentStatus: "pending",
    }));
    expect(mockStripeSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        metadata: expect.objectContaining({ flow: "renewal", tier: "pm", amount_cents: "15000" }),
        client_reference_id: expect.any(String),
      }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^renewal:pm:/) }),
    );
  });

  it("returns 400 when firstName missing", async () => {
    const response = await call({ ...VALID_BODY, firstName: "" });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.field).toBe("firstName");
  });

  it("returns 400 when email contains CR/LF (header injection guard)", async () => {
    const response = await call({ ...VALID_BODY, email: "alice@example.com\r\nBcc: spy@y.com" });
    expect(response.status).toBe(400);
  });

  it("accepts empty pdEntries — members can log PD after payment", async () => {
    const response = await call({ ...VALID_BODY, pdEntries: [] });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.url).toBeDefined();
    expect(mockAppendRenewal).toHaveBeenCalledWith(expect.objectContaining({ pdEntries: [] }));
  });

  it("returns 400 when pdEntries[0] missing required field", async () => {
    const response = await call({
      ...VALID_BODY,
      pdEntries: [{ dateCompleted: "2026-01-15", activity: "Workshop", provider: "" }],
    });
    expect(response.status).toBe(400);
  });

  it("returns 500 with code MISSING_CONFIG when STRIPE_PRODUCT_PM_RENEWAL not set", async () => {
    delete process.env.STRIPE_PRODUCT_PM_RENEWAL;
    mockResolveRenewalPrice.mockRejectedValueOnce(new Error("MISSING_CONFIG: STRIPE_PRODUCT_PM_RENEWAL not set"));

    const response = await call(VALID_BODY);
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("MISSING_CONFIG");
  });

  it("returns 500 with code PRICE_INACTIVE when Stripe returns no active price", async () => {
    process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";
    mockResolveRenewalPrice.mockRejectedValueOnce(new Error("PRICE_INACTIVE: no active price"));

    const response = await call(VALID_BODY);
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("PRICE_INACTIVE");
  });

  it("returns 500 with code CHECKOUT_ERROR on Stripe API error (retryable=false)", async () => {
    process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";
    mockStripeSessionsCreate.mockRejectedValueOnce(new Error("Stripe API error"));
    mockIsStripeRetryableError.mockReturnValue(false);

    const response = await call(VALID_BODY);
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("CHECKOUT_ERROR");
    expect(json.retryable).toBe(false);
  });

  it("returns 500 with retryable=true on StripeConnectionError", async () => {
    process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";
    mockStripeSessionsCreate.mockRejectedValueOnce(new Error("Stripe connection failed"));
    mockIsStripeRetryableError.mockReturnValue(true);

    const response = await call(VALID_BODY);
    const json = await response.json();
    expect(json.retryable).toBe(true);
  });

  it("dry-run: returns { dryRun: true } without creating session or appending row", async () => {
    process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";
    mockIsCheckoutDryRunEnabled.mockReturnValue(true);

    const response = await call(VALID_BODY);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.dryRun).toBe(true);
    expect(json.priceValidated).toBe(true);
    expect(json.priceId).toBe("price_pm_150");

    expect(mockAppendRenewal).not.toHaveBeenCalled();
    expect(mockStripeSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 500 with code SHEET_WRITE_FAILED when appendRenewal throws", async () => {
    process.env.STRIPE_PRODUCT_PM_RENEWAL = "prod_pm";
    mockAppendRenewal.mockRejectedValueOnce(new Error("OAuth token fetch failed"));

    const response = await call(VALID_BODY);
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("SHEET_WRITE_FAILED");
    expect(json.error).toMatch(/Failed to write renewal row/);
    expect(json.retryable).toBe(true);
    expect(mockStripeSessionsCreate).not.toHaveBeenCalled();
  });
});
