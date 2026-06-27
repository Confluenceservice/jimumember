import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStripeSessionsRetrieve = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn(function () {
    return { checkout: { sessions: { retrieve: mockStripeSessionsRetrieve } } };
  }),
}));
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

import { GET } from "./session-info";

async function call(sessionId: string | null) {
  const url = sessionId
    ? new URL(`https://test.example.com/api/renew/session-info?session_id=${sessionId}`)
    : new URL("https://test.example.com/api/renew/session-info");
  return GET({ url } as any);
}

describe("renew/session-info", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns tier, renewalYear, amountPaidCents from session metadata", async () => {
    mockStripeSessionsRetrieve.mockResolvedValueOnce({
      id: "cs_pm_1", payment_status: "paid",
      amount_total: 15000,
      metadata: { flow: "renewal", tier: "adv", renewal_year: "2026" },
    });

    const response = await call("cs_pm_1");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ tier: "adv", renewalYear: 2026, amountPaidCents: 15000 });
  });

  it("returns 400 when session_id missing", async () => {
    const response = await call(null);
    expect(response.status).toBe(400);
  });

  it("returns 404 when session is not a renewal", async () => {
    mockStripeSessionsRetrieve.mockResolvedValueOnce({
      id: "cs_other", payment_status: "paid",
      metadata: { flow: "option_c", tier: "advanced" },
    });

    const response = await call("cs_other");
    expect(response.status).toBe(404);
  });

  it("returns 500 when Stripe throws", async () => {
    mockStripeSessionsRetrieve.mockRejectedValueOnce(new Error("Stripe down"));
    const response = await call("cs_x");
    expect(response.status).toBe(500);
  });
});