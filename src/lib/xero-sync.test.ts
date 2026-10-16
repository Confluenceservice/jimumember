import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindInvoiceByNumber,
  mockFindContactByNumber,
  mockCreateContact,
  mockCreateInvoice,
  mockCreatePayment,
  mockAppendPending,
  mockMarkDone,
  mockMarkAttemptFailed,
  mockListPending,
  mockFindByStripeId,
} = vi.hoisted(() => ({
  mockFindInvoiceByNumber: vi.fn(),
  mockFindContactByNumber: vi.fn(),
  mockCreateContact: vi.fn(),
  mockCreateInvoice: vi.fn(),
  mockCreatePayment: vi.fn(),
  mockAppendPending: vi.fn(),
  mockMarkDone: vi.fn(),
  mockMarkAttemptFailed: vi.fn(),
  mockListPending: vi.fn(),
  mockFindByStripeId: vi.fn(),
}));

vi.mock("./xero-client", async () => {
  const actual = await vi.importActual<typeof import("./xero-client")>("./xero-client");
  return {
    XeroApiError: actual.XeroApiError,
    findInvoiceByNumber: mockFindInvoiceByNumber,
    findContactByNumber: mockFindContactByNumber,
    createContact: mockCreateContact,
    createInvoice: mockCreateInvoice,
    createPayment: mockCreatePayment,
  };
});

vi.mock("./xero-sync-sheet", () => ({
  appendPending: mockAppendPending,
  markDone: mockMarkDone,
  markAttemptFailed: mockMarkAttemptFailed,
  listPending: mockListPending,
  findByStripeId: mockFindByStripeId,
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { XeroApiError } from "./xero-client";
import {
  assertEnvironmentSafe,
  enqueueAndPush,
  isXeroEnabled,
  pushOne,
  sweepPending,
} from "./xero-sync";
import type { XeroSyncRecord } from "./xero-sync-sheet";

const RECORD: XeroSyncRecord = {
  stripeId: "cs_test_123",
  eventType: "checkout.session.completed",
  flow: "advanced_new",
  internalId: "app_1",
  email: "member@example.com",
  contactName: "A Member",
  amountCents: 12000,
  currency: "nzd",
  paidAt: "2026-07-15T02:00:00.000Z",
  feeCents: 378,
  livemode: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.XERO_ENABLED = "true";
  process.env.XERO_ALLOW_LIVE = "true";
  process.env.XERO_SALES_ACCOUNT_CODE = "200";
  process.env.XERO_STRIPE_FEED_ACCOUNT_ID = "feed-account-uuid";
  delete process.env.XERO_TAX_TYPE;

  mockFindInvoiceByNumber.mockResolvedValue(null);
  mockFindContactByNumber.mockResolvedValue(null);
  mockCreateContact.mockResolvedValue({ ContactID: "c1" });
  mockCreateInvoice.mockResolvedValue({ InvoiceID: "i1" });
  mockCreatePayment.mockResolvedValue({ PaymentID: "p1" });
  mockAppendPending.mockResolvedValue(undefined);
  mockMarkDone.mockResolvedValue(undefined);
  mockMarkAttemptFailed.mockResolvedValue(undefined);
  mockListPending.mockResolvedValue([]);
});

describe("isXeroEnabled", () => {
  it("accepts the usual truthy spellings and nothing else", () => {
    for (const v of ["true", "TRUE", "1", "yes", "on"]) {
      process.env.XERO_ENABLED = v;
      expect(isXeroEnabled()).toBe(true);
    }
    for (const v of ["false", "0", "", "maybe"]) {
      process.env.XERO_ENABLED = v;
      expect(isXeroEnabled()).toBe(false);
    }
    delete process.env.XERO_ENABLED;
    expect(isXeroEnabled()).toBe(false);
  });
});

describe("assertEnvironmentSafe", () => {
  it("permits a live event only on a live-allowed deployment", () => {
    process.env.XERO_ALLOW_LIVE = "true";
    expect(() => assertEnvironmentSafe(true)).not.toThrow();
    expect(() => assertEnvironmentSafe(false)).toThrow(/XERO_ENV_GUARD/);
  });

  it("permits a test event only on staging", () => {
    process.env.XERO_ALLOW_LIVE = "false";
    expect(() => assertEnvironmentSafe(false)).not.toThrow();
    expect(() => assertEnvironmentSafe(true)).toThrow(/XERO_ENV_GUARD/);
  });

  it("treats an unset XERO_ALLOW_LIVE as not-live", () => {
    delete process.env.XERO_ALLOW_LIVE;
    expect(() => assertEnvironmentSafe(true)).toThrow(/XERO_ENV_GUARD/);
  });
});

describe("enqueueAndPush — kill switch and guard", () => {
  it("does nothing at all when XERO_ENABLED is off", async () => {
    process.env.XERO_ENABLED = "false";

    await enqueueAndPush(RECORD);

    expect(mockAppendPending).not.toHaveBeenCalled();
    expect(mockFindInvoiceByNumber).not.toHaveBeenCalled();
  });

  it("leaves NO row behind when the environment guard blocks the event", async () => {
    // A wrong-environment event must not linger for the sweeper.
    process.env.XERO_ALLOW_LIVE = "false";

    await enqueueAndPush(RECORD);

    expect(mockAppendPending).not.toHaveBeenCalled();
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });
});

describe("pushOne — happy path payloads", () => {
  it("creates contact, invoice and payment, then marks the row done", async () => {
    await pushOne(RECORD);

    expect(mockCreateContact).toHaveBeenCalledTimes(1);
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
    expect(mockMarkDone).toHaveBeenCalledWith("cs_test_123", {
      contactId: "c1",
      invoiceId: "i1",
      paymentId: "p1",
    });
  });

  it("reuses an existing contact instead of creating a duplicate", async () => {
    mockFindContactByNumber.mockResolvedValueOnce({ ContactID: "c_existing" });

    await pushOne(RECORD);

    expect(mockCreateContact).not.toHaveBeenCalled();
    expect(mockCreateInvoice.mock.calls[0][0].Contact).toEqual({ ContactID: "c_existing" });
  });

  it("keys the contact on ContactNumber = normalised email, never on name", async () => {
    await pushOne(RECORD);

    expect(mockFindContactByNumber).toHaveBeenCalledWith("member@example.com");
    expect(mockCreateContact.mock.calls[0][0].ContactNumber).toBe("member@example.com");
  });

  it("builds a NoTax invoice whose total equals the Stripe gross to the cent", async () => {
    await pushOne(RECORD);

    const invoice = mockCreateInvoice.mock.calls[0][0];
    expect(invoice.LineAmountTypes).toBe("NoTax");
    expect(invoice.Status).toBe("AUTHORISED");
    expect(invoice.LineItems[0].UnitAmount).toBe(120);
    expect(invoice.LineItems[0].TaxType).toBe("NONE");
    expect(invoice.LineItems[0].AccountCode).toBe("200");
  });

  it("uses the Stripe id as the deterministic InvoiceNumber", async () => {
    await pushOne(RECORD);

    const invoice = mockCreateInvoice.mock.calls[0][0];
    expect(invoice.InvoiceNumber).toBe("cs_test_123");
    expect(invoice.Reference).toBe("advanced_new/app_1");
  });

  it("allows the TaxType to be corrected by env once the org’s TaxType is confirmed", async () => {
    process.env.XERO_TAX_TYPE = "ZERORATEDOUTPUT";

    await pushOne(RECORD);

    expect(mockCreateInvoice.mock.calls[0][0].LineItems[0].TaxType).toBe("ZERORATEDOUTPUT");
  });

  it("pays against the Stripe feed account, dated from the balance transaction", async () => {
    await pushOne(RECORD);

    const payment = mockCreatePayment.mock.calls[0][0];
    expect(payment.Account).toEqual({ AccountID: "feed-account-uuid" });
    // Deliberately NOT today: if this asserted today's date, "dated from
    // the balance transaction" and "dated now" would be indistinguishable.
    expect(payment.Date).toBe("2026-07-15");
    expect(payment.Date).not.toBe(new Date().toISOString().slice(0, 10));
    expect(payment.Amount).toBe(120);
    expect(payment.Reference).toBe("cs_test_123");
  });

  it("fails permanently when a required account is unconfigured", async () => {
    delete process.env.XERO_STRIPE_FEED_ACCOUNT_ID;

    await enqueueAndPush(RECORD);

    expect(mockMarkAttemptFailed).toHaveBeenCalledWith(
      "cs_test_123",
      expect.stringContaining("MISSING_CONFIG"),
      true,
    );
  });
});

describe("pushOne — idempotency and crash recovery", () => {
  it("short-circuits when the invoice is already fully paid", async () => {
    mockFindInvoiceByNumber.mockResolvedValueOnce({
      InvoiceID: "i_existing",
      AmountDue: 0,
      Payments: [{ PaymentID: "p_existing" }],
    });

    await pushOne(RECORD);

    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(mockCreatePayment).not.toHaveBeenCalled();
    expect(mockMarkDone).toHaveBeenCalledWith("cs_test_123", {
      invoiceId: "i_existing",
      paymentId: "p_existing",
    });
  });

  it("RESUMES an invoice that exists but was never paid", async () => {
    // The crash window between createInvoice and createPayment. Exiting
    // early here would leave an AUTHORISED invoice with no payment and the
    // clearing account would never net to zero.
    mockFindInvoiceByNumber.mockResolvedValueOnce({
      InvoiceID: "i_orphan",
      AmountDue: 120,
      Payments: [],
    });

    await pushOne(RECORD);

    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
    expect(mockCreatePayment.mock.calls[0][0].Invoice).toEqual({ InvoiceID: "i_orphan" });
    expect(mockMarkDone).toHaveBeenCalledWith("cs_test_123", {
      invoiceId: "i_orphan",
      paymentId: "p1",
    });
  });

  it("treats a present payment as settled when AmountDue is absent", async () => {
    mockFindInvoiceByNumber.mockResolvedValueOnce({
      InvoiceID: "i_existing",
      Payments: [{ PaymentID: "p_existing" }],
    });

    await pushOne(RECORD);

    expect(mockCreatePayment).not.toHaveBeenCalled();
  });

  it("never creates a second invoice for the same Stripe id", async () => {
    mockFindInvoiceByNumber.mockResolvedValue({
      InvoiceID: "i_existing",
      AmountDue: 0,
      Payments: [{ PaymentID: "p_existing" }],
    });

    await pushOne(RECORD);
    await pushOne(RECORD);

    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });
});

describe("enqueueAndPush — failure handling", () => {
  it("NEVER rejects when Xero throws, so the webhook can still return 200", async () => {
    mockCreateInvoice.mockRejectedValueOnce(new XeroApiError("XERO_API_503", 503, false));

    await expect(enqueueAndPush(RECORD)).resolves.toBeUndefined();
  });

  it("records a durable row before attempting the push", async () => {
    mockCreateInvoice.mockRejectedValueOnce(new XeroApiError("XERO_API_503", 503, false));

    await enqueueAndPush(RECORD);

    expect(mockAppendPending).toHaveBeenCalledWith(RECORD);
    expect(mockMarkAttemptFailed).toHaveBeenCalledWith("cs_test_123", "XERO_API_503", false);
  });

  it("carries the permanent flag through so the row leaves the sweep set", async () => {
    mockCreateInvoice.mockRejectedValueOnce(
      new XeroApiError("XERO_API_400 bad account code", 400, true),
    );

    await enqueueAndPush(RECORD);

    expect(mockMarkAttemptFailed).toHaveBeenCalledWith(
      "cs_test_123",
      expect.stringContaining("XERO_API_400"),
      true,
    );
  });

  it("treats an unknown non-Xero error as transient", async () => {
    mockCreateInvoice.mockRejectedValueOnce(new Error("ECONNRESET"));

    await enqueueAndPush(RECORD);

    expect(mockMarkAttemptFailed).toHaveBeenCalledWith("cs_test_123", "ECONNRESET", false);
  });
});

describe("sweepPending", () => {
  const pendingRow = {
    ...RECORD,
    status: "pending" as const,
    xeroContactId: "",
    xeroInvoiceId: "",
    xeroPaymentId: "",
    attempts: 1,
    lastError: "XERO_API_503",
    rowNumber: 2,
  };

  it("re-drives a pending row to done", async () => {
    mockListPending.mockResolvedValueOnce([pendingRow]);

    const result = await sweepPending();

    expect(result).toEqual({ swept: 1, done: 1, stillPending: 0, permanentFailures: 0 });
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the kill switch is off", async () => {
    process.env.XERO_ENABLED = "false";

    const result = await sweepPending();

    expect(result.swept).toBe(0);
    expect(mockListPending).not.toHaveBeenCalled();
  });

  it("skips rows belonging to the other environment", async () => {
    // Staging and production could share a spreadsheet; a sweep must never
    // push the other environment's rows.
    mockListPending.mockResolvedValueOnce([{ ...pendingRow, livemode: false }]);

    const result = await sweepPending();

    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(result).toMatchObject({ swept: 1, done: 0, stillPending: 1 });
  });

  it("keeps going after one row fails and counts the outcomes", async () => {
    mockListPending.mockResolvedValueOnce([
      { ...pendingRow, stripeId: "cs_a" },
      { ...pendingRow, stripeId: "cs_b" },
      { ...pendingRow, stripeId: "cs_c" },
    ]);
    mockCreateInvoice
      .mockRejectedValueOnce(new XeroApiError("XERO_API_503", 503, false))
      .mockRejectedValueOnce(new XeroApiError("XERO_API_400", 400, true))
      .mockResolvedValueOnce({ InvoiceID: "i1" });

    const result = await sweepPending();

    expect(result).toEqual({ swept: 3, done: 1, stillPending: 1, permanentFailures: 1 });
    expect(mockMarkAttemptFailed).toHaveBeenCalledTimes(2);
  });

  it("honours the limit it is given", async () => {
    mockListPending.mockResolvedValueOnce([]);

    await sweepPending(5);

    expect(mockListPending).toHaveBeenCalledWith(5);
  });
});
