import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockAuthorize, mockAppend, mockUpdate, mockGet, mockBatchUpdate, mockEnsureSheet } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockAuthorize: vi.fn(),
  mockAppend: vi.fn(),
  mockUpdate: vi.fn(),
  mockGet: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockEnsureSheet: vi.fn(),
}));

vi.mock("./google-auth", () => ({
  getServiceAccountJwtAuth: mockAuth.mockImplementation(() => ({
    authorize: mockAuthorize,
  })),
}));

vi.mock("googleapis", () => ({
  google: {
    sheets: vi.fn(function () {
      return {
        spreadsheets: {
          values: { append: mockAppend, update: mockUpdate, get: mockGet },
          batchUpdate: mockBatchUpdate,
          get: mockEnsureSheet,
        },
      };
    }),
  },
}));

process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";

import { appendRenewal, getRenewalBySession, markRenewalPaid, _resetSheetsClientCacheForTesting } from "./renewal-sheet";

describe("appendRenewal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSheetsClientCacheForTesting();
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";
    mockAuth.mockImplementation(() => ({ authorize: mockAuthorize }));
    mockAuthorize.mockResolvedValue({});
    mockAppend.mockResolvedValue({});
    mockEnsureSheet.mockResolvedValue({ data: { sheets: [{ properties: { title: "Renewals" } }] } });
  });

  afterEach(() => {
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  });

  it("appends a row with all 14 columns in correct order", async () => {
    await appendRenewal({
      renewalId: "r1",
      tier: "pm",
      year: 2026,
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@example.com",
      phone: "021234567",
      pdEntries: [{ dateCompleted: "2026-01-15", activity: "Workshop", totalHours: 3, provider: "Hospice NZ" }],
      amountCents: 15000,
      currency: "nzd",
      stripeSession: "cs_test_1",
      paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    });

    expect(mockAppend).toHaveBeenCalledTimes(1);
    const call = mockAppend.mock.calls[0][0];
    expect(call.range).toBe("'Renewals'!A1:N1");
    expect(call.requestBody.values[0]).toHaveLength(14);
    expect(call.requestBody.values[0][0]).toBe("r1");
    expect(call.requestBody.values[0][1]).toBe("pm");
    expect(call.requestBody.values[0][7]).toBe(JSON.stringify([{ dateCompleted: "2026-01-15", activity: "Workshop", totalHours: 3, provider: "Hospice NZ" }]));
    expect(call.requestBody.values[0][10]).toBe("pending");
  });

  it("calls ensureSheetWithHeaders on first write to create Renewals tab", async () => {
    mockEnsureSheet.mockResolvedValueOnce({ data: { sheets: [] } });

    await appendRenewal({
      renewalId: "r1", tier: "pm", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    });

    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(mockAppend).toHaveBeenCalledTimes(1);
  });

  it("does not re-create the Renewals tab on subsequent writes", async () => {
    mockEnsureSheet.mockResolvedValue({ data: { sheets: [{ properties: { title: "Renewals" } }] } });

    await appendRenewal({
      renewalId: "r1", tier: "pm", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    });

    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockAppend).toHaveBeenCalledTimes(1);
  });
});

describe("markRenewalPaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSheetsClientCacheForTesting();
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";
    mockAuth.mockImplementation(() => ({ authorize: mockAuthorize }));
    mockAuthorize.mockResolvedValue({});
    mockUpdate.mockResolvedValue({});
  });

  it("linear-scans column A for renewal_id then updates columns K and N", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        values: [
          ["renewal_id", "tier", "renewal_year", "first_name", "last_name", "email", "phone", "pd_entries", "amount_paid_cents", "currency", "payment_status", "stripe_session", "created_at", "paid_at"],
          ["r1", "pm", "2026", "Alice", "Smith", "alice@example.com", "", "[]", "15000", "nzd", "pending", "cs_1", "2026-06-23T10:00:00Z", ""],
        ],
      },
    });

    await markRenewalPaid("r1", "2026-06-23T11:00:00.000Z");

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.range).toBe("'Renewals'!K2:N2");
    expect(call.requestBody.values[0]).toEqual(["paid", "cs_1", "2026-06-23T10:00:00Z", "2026-06-23T11:00:00.000Z"]);
  });

  it("does nothing when renewal_id is not found", async () => {
    mockGet.mockResolvedValueOnce({
      data: { values: [["renewal_id"], ["other"]] },
    });

    await markRenewalPaid("missing", "2026-06-23T11:00:00.000Z");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("getRenewalBySession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSheetsClientCacheForTesting();
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";
    mockAuth.mockImplementation(() => ({ authorize: mockAuthorize }));
    mockAuthorize.mockResolvedValue({});
  });

  it("returns the row matching stripe_session", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        values: [
          ["renewal_id", "tier", "renewal_year", "first_name", "last_name", "email", "phone", "pd_entries", "amount_paid_cents", "currency", "payment_status", "stripe_session", "created_at", "paid_at"],
          ["r1", "pm", "2026", "Alice", "Smith", "alice@example.com", "", "[]", "15000", "nzd", "paid", "cs_target", "2026-06-23T10:00:00Z", "2026-06-23T11:00:00Z"],
        ],
      },
    });

    const result = await getRenewalBySession("cs_target");
    expect(result?.renewalId).toBe("r1");
    expect(result?.paymentStatus).toBe("paid");
    expect(result?.amountPaidCents).toBe(15000);
  });

  it("returns null when no row matches", async () => {
    mockGet.mockResolvedValueOnce({
      data: { values: [["renewal_id"], ["r1"]] },
    });

    const result = await getRenewalBySession("cs_missing");
    expect(result).toBeNull();
  });
});

describe("transient network retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSheetsClientCacheForTesting();
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";
    mockAuth.mockImplementation(() => ({ authorize: mockAuthorize }));
    mockAuthorize.mockResolvedValue({});
    mockEnsureSheet.mockResolvedValue({ data: { sheets: [{ properties: { title: "Renewals" } }] } });
  });

  function makeTransientError(): Error {
    const err = new Error("Invalid response body while trying to fetch https://www.googleapis.com/oauth2/v4/token: Premature close");
    (err as Error & { code?: string }).code = "ECONNRESET";
    return err;
  }

  it("retries the OAuth token refresh on Premature close (root cause of bug-033)", async () => {
    mockAuthorize
      .mockRejectedValueOnce(makeTransientError())
      .mockResolvedValueOnce(undefined);

    await appendRenewal({
      renewalId: "r1", tier: "pm", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    });

    expect(mockAuthorize).toHaveBeenCalledTimes(2);
    expect(mockAppend).toHaveBeenCalledTimes(1);
  });

  it("gives up on auth refresh after 3 attempts then surfaces error", async () => {
    mockAuthorize
      .mockRejectedValueOnce(makeTransientError())
      .mockRejectedValueOnce(makeTransientError())
      .mockRejectedValueOnce(makeTransientError());

    await expect(appendRenewal({
      renewalId: "r1", tier: "pm", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    })).rejects.toThrow(/Premature close/);

    expect(mockAuthorize).toHaveBeenCalledTimes(3);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("retries appendRenewal on Premature close then succeeds", async () => {
    mockAppend
      .mockRejectedValueOnce(makeTransientError())
      .mockResolvedValueOnce({});

    await appendRenewal({
      renewalId: "r1", tier: "pm", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    });

    expect(mockAppend).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on non-transient errors (e.g. 400 invalid)", async () => {
    const err = new Error("Invalid argument");
    mockAppend.mockRejectedValueOnce(err);

    await expect(appendRenewal({
      renewalId: "r1", tier: "pm", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    })).rejects.toThrow("Invalid argument");

    expect(mockAppend).toHaveBeenCalledTimes(1);
  });

  it("gives up after 3 attempts when transient errors persist", async () => {
    mockAppend
      .mockRejectedValueOnce(makeTransientError())
      .mockRejectedValueOnce(makeTransientError())
      .mockRejectedValueOnce(makeTransientError());

    await expect(appendRenewal({
      renewalId: "r1", tier: "pm", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    })).rejects.toThrow(/Premature close/);

    expect(mockAppend).toHaveBeenCalledTimes(3);
  });

  it("retries on EAI_AGAIN (DNS transient)", async () => {
    const err = new Error("getaddrinfo EAI_AGAIN");
    (err as Error & { code?: string }).code = "EAI_AGAIN";
    mockAppend.mockRejectedValueOnce(err).mockResolvedValueOnce({});

    await appendRenewal({
      renewalId: "r1", tier: "pm", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    });

    expect(mockAppend).toHaveBeenCalledTimes(2);
  });
});
