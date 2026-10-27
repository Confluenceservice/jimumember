import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  class FakeStripeError extends Error {}
  return {
    FakeStripeError,
    pricesRetrieve: vi.fn(),
    customersList: vi.fn(),
    subscriptionsList: vi.fn(),
    sessionsCreate: vi.fn(),
    appendBasicApplication: vi.fn(),
    validateTier: vi.fn(),
  };
});

vi.mock("stripe", () => {
  const Ctor: any = vi.fn(function () {
    return {
      prices: { retrieve: m.pricesRetrieve },
      customers: { list: m.customersList },
      subscriptions: { list: m.subscriptionsList },
      checkout: { sessions: { create: m.sessionsCreate } },
    };
  });
  Ctor.errors = { StripeError: m.FakeStripeError };
  return { default: Ctor };
});
vi.mock("../../lib/google-sheets", () => ({
  appendBasicApplication: m.appendBasicApplication,
}));
vi.mock("../../lib/forms/runtime", () => ({ validateTier: m.validateTier }));
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

import { POST } from "./create-checkout-session";

// Value printed by the pre-refactor code for annual=10000 at 2026-01-15T00:00:00Z
// (weeks until 1 July / 52). Hardcoded on purpose: the helper moves in Task 2.
const PRORATED = 4588;

const PRICE = { id: "price_basic", active: true, currency: "usd", unit_amount: 10000 };

async function call(body: Record<string, unknown>) {
  const request = new Request("https://app.test/api/create-checkout-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST({ request } as any);
}

const BASE_BODY = { plan: "basic", firstName: "Ann", lastName: "Lee", email: "A@B.test", phone: "021" };

describe("POST /api/create-checkout-session (characterization)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-15T00:00:00Z"));
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_1 = "price_basic";
    process.env.STRIPE_PRICE_2 = "price_adv";
    process.env.PUBLIC_APP_URL = "https://app.test";
    delete process.env.CHECKOUT_DRY_RUN;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    m.pricesRetrieve.mockResolvedValue(PRICE);
    m.customersList.mockResolvedValue({ data: [] });
    m.subscriptionsList.mockResolvedValue({ data: [] });
    m.sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" });
    m.appendBasicApplication.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("new customer gets prorated amount and option_c metadata", async () => {
    const res = await call(BASE_BODY);
    expect(res.status).toBe(200);
    expect(m.sessionsCreate).toHaveBeenCalledTimes(1);
    const [params, opts] = m.sessionsCreate.mock.calls[0];
    expect(params.mode).toBe("payment");
    expect(params.line_items[0].price_data.unit_amount).toBe(PRORATED);
    expect(params.line_items[0].price_data.currency).toBe("usd");
    expect(params.customer_creation).toBe("always");
    expect(params.customer_email).toBe("a@b.test");
    expect(params.customer).toBeUndefined();
    expect(params.client_reference_id).toBe("a@b.test");
    expect(params.metadata).toMatchObject({
      flow: "option_c",
      plan: "basic",
      recurring_price_id: "price_basic",
      annual_amount: "10000",
      first_name: "Ann",
      last_name: "Lee",
      phone: "021",
    });
    expect(params.payment_intent_data).toEqual({ setup_future_usage: "off_session", receipt_email: "a@b.test" });
    expect(params.success_url).toBe("https://app.test/associate-membership?session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toBe("https://app.test/cancel");
    expect(opts).toEqual({ idempotencyKey: `checkout:basic:a@b.test:${PRORATED}` });
    expect(await res.json()).toMatchObject({
      id: "cs_1",
      url: "https://stripe.test/cs_1",
      plan: "basic",
      firstTermAmount: PRORATED,
      annualAmount: 10000,
      proratedFirstTerm: true,
    });
  });

  it("returning customer with prior subscription pays full annual and reuses customer", async () => {
    m.customersList.mockResolvedValue({ data: [{ id: "cus_1" }] });
    m.subscriptionsList.mockResolvedValue({ data: [{ id: "sub_old" }] });
    const res = await call(BASE_BODY);
    expect(res.status).toBe(200);
    expect(m.subscriptionsList).toHaveBeenCalledWith({ customer: "cus_1", status: "all", limit: 1 });
    const [params] = m.sessionsCreate.mock.calls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(10000);
    expect(params.customer).toBe("cus_1");
    expect(params.customer_creation).toBeUndefined();
    expect((await res.json()).proratedFirstTerm).toBe(false);
  });

  it("advanced plan success_url is /success", async () => {
    m.pricesRetrieve.mockResolvedValue({ ...PRICE, id: "price_adv" });
    await call({ ...BASE_BODY, plan: "advanced" });
    const [params, opts] = m.sessionsCreate.mock.calls[0];
    expect(params.success_url).toBe("https://app.test/success?session_id={CHECKOUT_SESSION_ID}");
    expect(params.metadata.plan).toBe("advanced");
    expect(params.metadata.recurring_price_id).toBe("price_adv");
    expect(opts.idempotencyKey).toBe(`checkout:advanced:a@b.test:${PRORATED}`);
  });

  it("basic apply source appends a Basic Applications row and adds basic_application_id metadata", async () => {
    m.validateTier.mockResolvedValue({
      ok: true,
      values: { fullAddress: "1 St", listOnPage: "yes", signature: "Ann" },
    });
    const res = await call({ ...BASE_BODY, applicationSource: "apply" });
    expect(res.status).toBe(200);
    expect(m.appendBasicApplication).toHaveBeenCalledTimes(1);
    const row = m.appendBasicApplication.mock.calls[0][0];
    expect(row).toMatchObject({ email: "a@b.test", fullAddress: "1 St", checkoutStatus: "checkout_requested" });
    const [params] = m.sessionsCreate.mock.calls[0];
    expect(params.metadata.application_source).toBe("apply");
    expect(params.metadata.basic_application_id).toBe(row.applicationId);
    expect(params.metadata.list_on_page).toBe("yes");
  });

  it("dry run returns dryRun:true and creates no session", async () => {
    process.env.CHECKOUT_DRY_RUN = "true";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    const res = await call(BASE_BODY);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.message).toContain("Stripe keys and price configuration validated");
    expect(m.sessionsCreate).not.toHaveBeenCalled();
  });

  it("dry run without STRIPE_WEBHOOK_SECRET is a 500", async () => {
    process.env.CHECKOUT_DRY_RUN = "true";
    const res = await call(BASE_BODY);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Server is missing STRIPE_WEBHOOK_SECRET required for dry-run validation.");
  });

  it("missing STRIPE_SECRET_KEY is a 500", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await call(BASE_BODY);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Server is missing STRIPE_SECRET_KEY.");
  });

  it("missing recurring price env is a 500", async () => {
    delete process.env.STRIPE_PRICE_1;
    const res = await call(BASE_BODY);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Server is missing recurring price ID for plan 'basic'.");
  });

  it("non-usd price is a 500", async () => {
    m.pricesRetrieve.mockResolvedValue({ ...PRICE, currency: "nzd" });
    const res = await call(BASE_BODY);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Recurring price must be a fixed USD amount.");
  });

  it("rejects an invalid plan with 400", async () => {
    const res = await call({ ...BASE_BODY, plan: "gold" });
    expect(res.status).toBe(400);
  });

  it("Stripe error surfaces its message as a 500", async () => {
    m.sessionsCreate.mockRejectedValue(new m.FakeStripeError("card_declined_xyz"));
    const res = await call(BASE_BODY);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("card_declined_xyz");
  });

  it("non-Stripe error returns the generic message", async () => {
    m.sessionsCreate.mockRejectedValue(new Error("boom"));
    const res = await call(BASE_BODY);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Unable to create checkout session.");
  });
});
