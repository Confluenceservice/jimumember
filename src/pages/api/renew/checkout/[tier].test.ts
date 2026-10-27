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

vi.mock("../../../../lib/stripe-products", () => ({
  resolveRenewalPrice: mockResolveRenewalPrice,
  invalidateRenewalPriceCache: vi.fn(),
}));
vi.mock("../../../../lib/renewal-sheet", () => ({
  appendRenewal: mockAppendRenewal,
  markRenewalPaid: vi.fn(),
  getRenewalById: vi.fn(),
}));
vi.mock("../../../../lib/membership-terms", () => ({
  getSiteBaseUrl: mockGetSiteBaseUrl,
  isCheckoutDryRunEnabled: mockIsCheckoutDryRunEnabled,
}));
vi.mock("../../../../lib/stripe-checkout", () => ({
  isStripeRetryableError: mockIsStripeRetryableError,
}));
vi.mock("stripe", () => ({
  default: vi.fn(function () {
    return { checkout: { sessions: { create: mockStripeSessionsCreate } } };
  }),
}));

process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_PRICE_1 = "price_basic_75";

import { POST } from "./[tier]";

const VALID_BODY = { firstName: "Bob", lastName: "Doe", email: "bob@example.com", year: 2026 };

async function call(body: unknown, tier = "basic") {
  const request = new Request(`https://test.example.com/api/renew/checkout/${tier}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST({ request, params: { tier } } as any);
}

describe("checkout/[tier]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCheckoutDryRunEnabled.mockReturnValue(false);
    mockResolveRenewalPrice.mockResolvedValue({ priceId: "price_basic_75", currency: "nzd", unitAmount: 7500 });
    mockAppendRenewal.mockResolvedValue(undefined);
    mockStripeSessionsCreate.mockResolvedValue({ id: "cs_am_1", url: "https://stripe.com/c/cs_am_1" });
  });

  it("happy path (associate): writes tier=basic to sheet; tier in metadata, pd_entries NOT in metadata", async () => {
    const response = await call(VALID_BODY, "basic");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.url).toBe("https://stripe.com/c/cs_am_1");

    expect(mockResolveRenewalPrice).toHaveBeenCalledWith("basic_renewal");
    expect(mockAppendRenewal).toHaveBeenCalledWith(expect.objectContaining({
      tier: "basic", phone: "", pdEntries: [], amountCents: 7500, paymentStatus: "pending",
    }));
    expect(mockStripeSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ quantity: 1, price: "price_basic_75" }],
        metadata: expect.objectContaining({
          flow: "renewal", tier: "basic", amount_cents: "7500",
        }),
      }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^renewal:basic:/) }),
    );
    // pd_entries must NOT be sent to Stripe (500-char metadata limit guard)
    expect(mockStripeSessionsCreate.mock.calls[0][0].metadata).not.toHaveProperty("pd_entries");
  });

  it("happy path (professional): phone + pdEntries go to sheet; pd_entries NOT in metadata", async () => {
    mockResolveRenewalPrice.mockResolvedValue({ priceId: "price_adv_150", currency: "nzd", unitAmount: 15000 });
    const proBody = {
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@example.com",
      phone: "+64 21 123 4567",
      year: 2026,
      pdEntries: [
        { dateCompleted: "2026-03-15", activity: "Webinar", totalHours: 2, provider: "Example Training Co" },
      ],
    };
    const response = await call(proBody, "advanced");
    expect(response.status).toBe(200);

    expect(mockResolveRenewalPrice).toHaveBeenCalledWith("adv_renewal");
    expect(mockAppendRenewal).toHaveBeenCalledWith(expect.objectContaining({
      tier: "adv",
      phone: "+64 21 123 4567",
      pdEntries: proBody.pdEntries,
      amountCents: 15000,
    }));
    expect(mockStripeSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ quantity: 1, price: "price_adv_150" }],
        metadata: expect.objectContaining({
          flow: "renewal", tier: "adv",
          phone: "+64 21 123 4567",
          amount_cents: "15000",
        }),
        cancel_url: expect.stringContaining("phone=%2B64%2021%20123%204567"),
      }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^renewal:adv:/) }),
    );
    expect(mockStripeSessionsCreate.mock.calls[0][0].metadata).not.toHaveProperty("pd_entries");
  });

  it("professional with empty pdEntries writes [] to sheet; metadata omits pd_entries", async () => {
    mockResolveRenewalPrice.mockResolvedValue({ priceId: "price_adv_150", currency: "nzd", unitAmount: 15000 });
    const response = await call({
      firstName: "Alice", lastName: "Smith", email: "alice@example.com",
      phone: "021 123 4567", year: 2026, pdEntries: [],
    }, "advanced");
    expect(response.status).toBe(200);
    expect(mockAppendRenewal).toHaveBeenCalledWith(expect.objectContaining({
      tier: "adv", phone: "021 123 4567", pdEntries: [],
    }));
    expect(mockStripeSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ phone: "021 123 4567" }),
      }),
      expect.anything(),
    );
    expect(mockStripeSessionsCreate.mock.calls[0][0].metadata).not.toHaveProperty("pd_entries");
  });

  it("uses dynamic [tier] URL segment as the route parameter", async () => {
    await call(VALID_BODY, "basic");
    expect(mockResolveRenewalPrice).toHaveBeenCalledWith("basic_renewal");
  });

  it("returns 400 on missing fields", async () => {
    expect((await call({ firstName: "", lastName: "Doe", email: "bob@example.com", year: 2026 })).status).toBe(400);
    expect((await call({ firstName: "Bob", lastName: "", email: "bob@example.com", year: 2026 })).status).toBe(400);
    expect((await call({ firstName: "Bob", lastName: "Doe", email: "", year: 2026 })).status).toBe(400);
  });

  it("returns 400 on invalid email", async () => {
    expect((await call({ ...VALID_BODY, email: "not-an-email" })).status).toBe(400);
  });

  it("returns 400 on unknown tier slug", async () => {
    const response = await call(VALID_BODY, "unknown-tier");
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.field).toBe("tier");
  });

  it("returns 500 MISSING_CONFIG when STRIPE_PRICE_1_RENEWAL missing", async () => {
    mockResolveRenewalPrice.mockRejectedValueOnce(new Error("MISSING_CONFIG: STRIPE_PRICE_1_RENEWAL not set"));
    const response = await call(VALID_BODY, "basic");
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("MISSING_CONFIG");
  });

  it("dry-run returns { dryRun: true } without creating session or writing sheet", async () => {
    mockIsCheckoutDryRunEnabled.mockReturnValue(true);
    const response = await call(VALID_BODY, "basic");
    const json = await response.json();
    expect(json.dryRun).toBe(true);
    expect(mockStripeSessionsCreate).not.toHaveBeenCalled();
    expect(mockAppendRenewal).not.toHaveBeenCalled();
  });

  it("returns 500 CHECKOUT_ERROR on Stripe error", async () => {
    mockStripeSessionsCreate.mockRejectedValueOnce(new Error("stripe failed"));
    const response = await call(VALID_BODY, "basic");
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("CHECKOUT_ERROR");
  });

  it("returns 500 SHEET_WRITE_FAILED retryable=true when appendRenewal throws", async () => {
    mockAppendRenewal.mockRejectedValueOnce(new Error("OAuth token fetch failed"));
    const response = await call(VALID_BODY, "basic");
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("SHEET_WRITE_FAILED");
    expect(json.retryable).toBe(true);
    expect(mockStripeSessionsCreate).not.toHaveBeenCalled();
  });
});