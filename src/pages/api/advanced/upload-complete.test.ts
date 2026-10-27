import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  class FakeStripeError extends Error {}
  return {
    FakeStripeError,
    pricesRetrieve: vi.fn(),
    sessionsCreate: vi.fn(),
    getApplicantByToken: vi.fn(),
    validateCompletion: vi.fn(),
  };
});

vi.mock("stripe", () => {
  const Ctor: any = vi.fn(function () {
    return {
      prices: { retrieve: m.pricesRetrieve },
      checkout: { sessions: { create: m.sessionsCreate } },
    };
  });
  Ctor.errors = { StripeError: m.FakeStripeError };
  return { default: Ctor };
});
vi.mock("../../../lib/upload-sheet", () => ({
  getApplicantByToken: m.getApplicantByToken,
  validateCompletion: m.validateCompletion,
}));
vi.mock("../../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

import { POST } from "./upload-complete";
import { invalidateStripePriceCache } from "../../../lib/payments/stripe/prices";
import { resetStripeClientForTests } from "../../../lib/payments/stripe/client";

// Value printed by the pre-refactor code for annual=15000 at 2026-01-15T00:00:00Z.
// Hardcoded on purpose: the proration helper moves in Task 2.
const PRORATED = 6882;

const APPLICANT = { id: "app_1", email: "p@x.test", firstName: "Pat", lastName: "Doe", paid: "" };

async function call(body: unknown) {
  const request = new Request("https://app.test/api/advanced/upload-complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST({ request, url: new URL(request.url) } as any);
}

describe("POST /api/advanced/upload-complete (characterization)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateStripePriceCache();
    resetStripeClientForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-15T00:00:00Z"));
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_2 = "price_adv";
    process.env.PUBLIC_APP_URL = "https://app.test";
    delete process.env.CHECKOUT_DRY_RUN;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    m.getApplicantByToken.mockResolvedValue(APPLICANT);
    m.validateCompletion.mockResolvedValue(true);
    m.pricesRetrieve.mockResolvedValue({ id: "price_adv", active: true, currency: "usd", unit_amount: 15000 });
    m.sessionsCreate.mockResolvedValue({ id: "cs_9", url: "https://stripe.test/cs_9" });
  });
  afterEach(() => vi.useRealTimers());

  it("creates a prorated session with applicant metadata", async () => {
    const res = await call({ token: "tok_1" });
    expect(res.status).toBe(200);
    const [params, opts] = m.sessionsCreate.mock.calls[0];
    expect(params.mode).toBe("payment");
    expect(params.line_items[0].price_data.unit_amount).toBe(PRORATED);
    expect(params.line_items[0].price_data.product_data.name).toBe("Advanced Membership");
    expect(params.metadata).toMatchObject({
      flow: "option_c",
      plan: "advanced",
      applicant_id: "app_1",
      resume_token: "tok_1",
      recurring_price_id: "price_adv",
      annual_amount: "15000",
      first_name: "Pat",
      last_name: "Doe",
    });
    expect(params.client_reference_id).toBe("app_1");
    expect(params.customer_creation).toBe("always");
    expect(params.customer_email).toBe("p@x.test");
    expect(params.payment_intent_data).toEqual({ setup_future_usage: "off_session", receipt_email: "p@x.test" });
    expect(params.success_url).toBe("https://app.test/advanced/success-upload?session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toBe("https://app.test/advanced/apply?token=tok_1");
    expect(opts).toEqual({ idempotencyKey: `upload-complete:app_1:${PRORATED}` });
    expect(await res.json()).toMatchObject({
      id: "cs_9",
      url: "https://stripe.test/cs_9",
      plan: "advanced",
      firstTermAmount: PRORATED,
      annualAmount: 15000,
      proratedFirstTerm: true,
    });
  });

  it("already paid is a 400 ALREADY_COMPLETED", async () => {
    m.getApplicantByToken.mockResolvedValue({ ...APPLICANT, paid: "TRUE" });
    const res = await call({ token: "tok_1" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("ALREADY_COMPLETED");
  });

  it("incomplete application is a 400 INCOMPLETE", async () => {
    m.validateCompletion.mockResolvedValue(false);
    const res = await call({ token: "tok_1" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INCOMPLETE");
  });

  it("unknown token is a 400 INVALID_TOKEN", async () => {
    m.getApplicantByToken.mockResolvedValue(null);
    const res = await call({ token: "nope" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_TOKEN");
  });

  it("missing STRIPE_SECRET_KEY is a 500 MISSING_CONFIG", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await call({ token: "tok_1" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Server is missing STRIPE_SECRET_KEY.", code: "MISSING_CONFIG" });
  });

  it("missing STRIPE_PRICE_2 is a 500 MISSING_CONFIG", async () => {
    delete process.env.STRIPE_PRICE_2;
    const res = await call({ token: "tok_1" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Server is missing STRIPE_PRICE_2.", code: "MISSING_CONFIG" });
  });

  it("dry run validates and creates no session", async () => {
    process.env.CHECKOUT_DRY_RUN = "true";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    const res = await call({ token: "tok_1" });
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.plan).toBe("advanced");
    expect(m.sessionsCreate).not.toHaveBeenCalled();
  });

  it("Stripe connection error is a 500 CHECKOUT_ERROR retryable", async () => {
    const err = new Error("net down");
    err.name = "StripeConnectionError";
    m.sessionsCreate.mockRejectedValue(err);
    const res = await call({ token: "tok_1" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Failed to create checkout session.",
      code: "CHECKOUT_ERROR",
      retryable: true,
    });
  });

  it("a transient Stripe error while looking up the price is still retryable", async () => {
    const err = new Error("net down");
    err.name = "StripeConnectionError";
    m.pricesRetrieve.mockRejectedValue(err);
    const res = await call({ token: "tok_1" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_ERROR", retryable: true });
  });

  it("trims whitespace around STRIPE_PRICE_2 (professional checkout always did)", async () => {
    process.env.STRIPE_PRICE_2 = "price_adv\n";
    const res = await call({ token: "tok_1" });
    expect(res.status).toBe(200);
    expect(m.pricesRetrieve).toHaveBeenCalledWith("price_adv");
  });

  it("other error is a 500 CHECKOUT_ERROR not retryable", async () => {
    m.sessionsCreate.mockRejectedValue(new Error("boom"));
    const res = await call({ token: "tok_1" });
    expect((await res.json()).retryable).toBe(false);
  });
});
