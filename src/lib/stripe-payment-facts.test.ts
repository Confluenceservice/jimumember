import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getPaymentFacts } from "./stripe-payment-facts";

// 2026-07-15T02:00:00Z — deliberately NOT the day these tests run, so a
// balance-transaction date is distinguishable from "now" or from `created`.
const BT_CREATED = 1784080800;
const BT_ISO = new Date(BT_CREATED * 1000).toISOString();

// 2026-07-20T02:00:00Z — the object's own created stamp, a different day
// again, so a fallback is distinguishable from a real resolution.
const OBJ_CREATED = 1784512800;
const OBJ_ISO = new Date(OBJ_CREATED * 1000).toISOString();

function session(overrides: Record<string, unknown> = {}): Stripe.Checkout.Session {
  return {
    object: "checkout.session",
    id: "cs_test_123",
    created: OBJ_CREATED,
    amount_total: 12000,
    payment_intent: "pi_123",
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

function invoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    object: "invoice",
    id: "in_123",
    created: OBJ_CREATED,
    amount_paid: 9000,
    ...overrides,
  } as unknown as Stripe.Invoice;
}

const BALANCE_TX = { id: "txn_1", created: BT_CREATED, fee: 378, net: 11622 };

let stripe: {
  paymentIntents: { retrieve: ReturnType<typeof vi.fn> };
  charges: { retrieve: ReturnType<typeof vi.fn> };
  invoices: { retrieve: ReturnType<typeof vi.fn> };
  balanceTransactions: { retrieve: ReturnType<typeof vi.fn> };
};

function asStripe(): Stripe {
  return stripe as unknown as Stripe;
}

beforeEach(() => {
  vi.clearAllMocks();
  stripe = {
    paymentIntents: { retrieve: vi.fn() },
    charges: { retrieve: vi.fn() },
    invoices: { retrieve: vi.fn() },
    balanceTransactions: { retrieve: vi.fn() },
  };
});

describe("checkout session", () => {
  it("takes the date and fee from the balance transaction, not from `created`", async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: "ch_1", balance_transaction: BALANCE_TX },
    });

    const facts = await getPaymentFacts(asStripe(), session());

    expect(facts).toEqual({
      paidAt: BT_ISO,
      feeCents: 378,
      netCents: 11622,
      fallback: false,
    });
    // The whole point: not the session's own timestamp.
    expect(facts.paidAt).not.toBe(OBJ_ISO);
  });

  it("expands latest_charge.balance_transaction in one call", async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: "ch_1", balance_transaction: BALANCE_TX },
    });

    await getPaymentFacts(asStripe(), session());

    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_123", {
      expand: ["latest_charge.balance_transaction"],
    });
    expect(stripe.balanceTransactions.retrieve).not.toHaveBeenCalled();
  });

  it("accepts an already-expanded payment_intent object", async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: "ch_1", balance_transaction: BALANCE_TX },
    });

    await getPaymentFacts(asStripe(), session({ payment_intent: { id: "pi_expanded" } }));

    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_expanded", expect.anything());
  });

  it("fetches the balance transaction separately if it came back as an id", async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: "ch_1", balance_transaction: "txn_1" },
    });
    stripe.balanceTransactions.retrieve.mockResolvedValue(BALANCE_TX);

    const facts = await getPaymentFacts(asStripe(), session());

    expect(stripe.balanceTransactions.retrieve).toHaveBeenCalledWith("txn_1");
    expect(facts.paidAt).toBe(BT_ISO);
  });

  it("falls back when the session never had a payment intent", async () => {
    const facts = await getPaymentFacts(asStripe(), session({ payment_intent: null }));

    expect(facts).toEqual({
      paidAt: OBJ_ISO,
      feeCents: 0,
      netCents: 12000,
      fallback: true,
    });
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
});

describe("invoice", () => {
  it("resolves through invoice.payments[].payment.payment_intent", async () => {
    // Invoices no longer expose a top-level `charge` or `payment_intent`.
    stripe.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: "ch_1", balance_transaction: BALANCE_TX },
    });

    const facts = await getPaymentFacts(
      asStripe(),
      invoice({
        payments: { data: [{ payment: { type: "payment_intent", payment_intent: "pi_inv" } }] },
      }),
    );

    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_inv", expect.anything());
    expect(facts.paidAt).toBe(BT_ISO);
    expect(facts.fallback).toBe(false);
  });

  it("resolves a charge-typed payment via the charges endpoint", async () => {
    stripe.charges.retrieve.mockResolvedValue({
      id: "ch_direct",
      balance_transaction: BALANCE_TX,
    });

    const facts = await getPaymentFacts(
      asStripe(),
      invoice({ payments: { data: [{ payment: { type: "charge", charge: "ch_direct" } }] } }),
    );

    expect(stripe.charges.retrieve).toHaveBeenCalledWith("ch_direct", {
      expand: ["balance_transaction"],
    });
    expect(facts.feeCents).toBe(378);
  });

  it("fetches the payments list when the webhook payload omits it", async () => {
    stripe.invoices.retrieve.mockResolvedValue({
      payments: { data: [{ payment: { type: "payment_intent", payment_intent: "pi_late" } }] },
    });
    stripe.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: "ch_1", balance_transaction: BALANCE_TX },
    });

    const facts = await getPaymentFacts(asStripe(), invoice());

    expect(stripe.invoices.retrieve).toHaveBeenCalledWith("in_123", { expand: ["payments"] });
    expect(facts.paidAt).toBe(BT_ISO);
  });

  it("falls back to amount_paid, not amount_total, for an invoice", async () => {
    stripe.invoices.retrieve.mockResolvedValue({ payments: { data: [] } });

    const facts = await getPaymentFacts(asStripe(), invoice());

    expect(facts).toEqual({
      paidAt: OBJ_ISO,
      feeCents: 0,
      netCents: 9000,
      fallback: true,
    });
  });

  it("falls back when the payment is a type we cannot resolve", async () => {
    const facts = await getPaymentFacts(
      asStripe(),
      invoice({
        payments: { data: [{ payment: { type: "payment_record", payment_record: "pr_1" } }] },
      }),
    );

    expect(facts.fallback).toBe(true);
    expect(facts.paidAt).toBe(OBJ_ISO);
  });
});

describe("never throws", () => {
  it("falls back when Stripe errors, rather than dropping the payment", async () => {
    // A slightly wrong date is fixable by hand; a missing Xero invoice is not.
    stripe.paymentIntents.retrieve.mockRejectedValue(new Error("Stripe 503"));

    const facts = await getPaymentFacts(asStripe(), session());

    expect(facts.fallback).toBe(true);
    expect(facts.paidAt).toBe(OBJ_ISO);
    expect(facts.netCents).toBe(12000);
  });

  it("falls back when the charge has no balance transaction at all", async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: "ch_1", balance_transaction: null },
    });

    expect((await getPaymentFacts(asStripe(), session())).fallback).toBe(true);
  });

  it("falls back when latest_charge came back unexpanded", async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue({ latest_charge: "ch_unexpanded" });

    expect((await getPaymentFacts(asStripe(), session())).fallback).toBe(true);
  });

  it("marks the fallback so callers can tell a real date from a guessed one", async () => {
    stripe.paymentIntents.retrieve.mockRejectedValue(new Error("boom"));
    expect((await getPaymentFacts(asStripe(), session())).fallback).toBe(true);

    stripe.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: "ch_1", balance_transaction: BALANCE_TX },
    });
    expect((await getPaymentFacts(asStripe(), session())).fallback).toBe(false);
  });
});
