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

import { appendRenewal, getRenewalById, markRenewalPaid, _resetSheetsClientCacheForTesting } from "./renewal-sheet";

describe("appendRenewal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSheetsClientCacheForTesting();
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";
    mockAuth.mockImplementation(() => ({ authorize: mockAuthorize }));
    mockAuthorize.mockResolvedValue({});
    mockAppend.mockResolvedValue({});
    mockEnsureSheet.mockResolvedValue({ data: { sheets: [{ properties: { title: "Renewals", sheetId: 123 } }] } });
    // header check (A1:A1) sees header present → heal path skipped
    mockGet.mockResolvedValue({ data: { values: [["renewal_id"]] } });
  });

  afterEach(() => {
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  });

  it("appends a row with all 14 columns in correct order", async () => {
    await appendRenewal({
      renewalId: "r1",
      tier: "adv",
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
    expect(call.requestBody.values[0][1]).toBe("adv");
    expect(call.requestBody.values[0][7]).toBe(JSON.stringify([{ dateCompleted: "2026-01-15", activity: "Workshop", totalHours: 3, provider: "Hospice NZ" }]));
    expect(call.requestBody.values[0][10]).toBe("pending");
  });

  it("calls ensureSheetWithHeaders on first write to create Renewals tab", async () => {
    mockEnsureSheet.mockResolvedValueOnce({ data: { sheets: [] } });

    await appendRenewal({
      renewalId: "r1", tier: "adv", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    });

    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(mockAppend).toHaveBeenCalledTimes(1);
  });

  it("does not re-create the Renewals tab on subsequent writes", async () => {
    mockEnsureSheet.mockResolvedValue({ data: { sheets: [{ properties: { title: "Renewals", sheetId: 123 } }] } });

    await appendRenewal({
      renewalId: "r1", tier: "adv", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    });

    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockAppend).toHaveBeenCalledTimes(1);
  });

  it("self-heals a missing header row: inserts a row at top and writes headers", async () => {
    mockEnsureSheet.mockResolvedValue({ data: { sheets: [{ properties: { title: "Renewals", sheetId: 123 } }] } });
    // header check (A1:A1) returns a DATA row, not the header
    mockGet.mockResolvedValue({ data: { values: [["ad28eb82-data-row-id"]] } });

    await appendRenewal({
      renewalId: "r2", tier: "adv", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    });

    // insertDimension at row 0
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    const insertCall = mockBatchUpdate.mock.calls[0][0];
    expect(insertCall.requestBody.requests[0].insertDimension.range).toMatchObject({
      sheetId: 123, dimension: "ROWS", startIndex: 0, endIndex: 1,
    });
    // header backfill to A1:N1, plus the appended data row → 2 update calls
    const headerWrite = mockUpdate.mock.calls.find((c) => c[0].range === "'Renewals'!A1:N1");
    expect(headerWrite).toBeTruthy();
    expect(headerWrite![0].requestBody.values[0][0]).toBe("renewal_id");
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

  it("linear-scans column A for renewal_id then updates columns K and N, backfilling stripe_session", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        values: [
          ["renewal_id", "tier", "renewal_year", "first_name", "last_name", "email", "phone", "pd_entries", "amount_paid_cents", "currency", "payment_status", "stripe_session", "created_at", "paid_at"],
          ["r1", "adv", "2026", "Alice", "Smith", "alice@example.com", "", "[]", "15000", "nzd", "pending", "", "2026-06-23T10:00:00Z", ""],
        ],
      },
    });

    await markRenewalPaid("r1", "cs_live_1", "2026-06-23T11:00:00.000Z");

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.range).toBe("'Renewals'!K2:N2");
    expect(call.requestBody.values[0]).toEqual(["paid", "cs_live_1", "2026-06-23T10:00:00Z", "2026-06-23T11:00:00.000Z"]);
  });

  it("does nothing when renewal_id is not found", async () => {
    mockGet.mockResolvedValueOnce({
      data: { values: [["renewal_id"], ["other"]] },
    });

    await markRenewalPaid("missing", "cs_x", "2026-06-23T11:00:00.000Z");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("getRenewalById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSheetsClientCacheForTesting();
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";
    mockAuth.mockImplementation(() => ({ authorize: mockAuthorize }));
    mockAuthorize.mockResolvedValue({});
  });

  it("returns the row matching renewal_id (col A)", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        values: [
          ["renewal_id", "tier", "renewal_year", "first_name", "last_name", "email", "phone", "pd_entries", "amount_paid_cents", "currency", "payment_status", "stripe_session", "created_at", "paid_at"],
          ["r1", "adv", "2026", "Alice", "Smith", "alice@example.com", "", "[]", "15000", "nzd", "pending", "", "2026-06-23T10:00:00Z", ""],
        ],
      },
    });

    const result = await getRenewalById("r1");
    expect(result?.renewalId).toBe("r1");
    expect(result?.paymentStatus).toBe("pending");
    expect(result?.amountPaidCents).toBe(15000);
  });

  it("returns null when no row matches", async () => {
    mockGet.mockResolvedValueOnce({
      data: { values: [["renewal_id"], ["r1"]] },
    });

    const result = await getRenewalById("missing");
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
      renewalId: "r1", tier: "adv", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    });

    expect(mockAuthorize).toHaveBeenCalledTimes(2);
    expect(mockAppend).toHaveBeenCalledTimes(1);
  });

  it("gives up on auth refresh after 5 attempts then surfaces error", { timeout: 15000 }, async () => {
    mockAuthorize
      .mockRejectedValueOnce(makeTransientError())
      .mockRejectedValueOnce(makeTransientError())
      .mockRejectedValueOnce(makeTransientError())
      .mockRejectedValueOnce(makeTransientError())
      .mockRejectedValueOnce(makeTransientError());

    await expect(appendRenewal({
      renewalId: "r1", tier: "adv", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    })).rejects.toThrow(/Premature close/);

    expect(mockAuthorize).toHaveBeenCalledTimes(5);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("retries appendRenewal on Premature close then succeeds", async () => {
    mockAppend
      .mockRejectedValueOnce(makeTransientError())
      .mockResolvedValueOnce({});

    await appendRenewal({
      renewalId: "r1", tier: "adv", year: 2026, firstName: "A", lastName: "B",
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
      renewalId: "r1", tier: "adv", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    })).rejects.toThrow("Invalid argument");

    expect(mockAppend).toHaveBeenCalledTimes(1);
  });

  it("gives up after 5 attempts when transient errors persist", { timeout: 15000 }, async () => {
    mockAppend
      .mockRejectedValueOnce(makeTransientError())
      .mockRejectedValueOnce(makeTransientError())
      .mockRejectedValueOnce(makeTransientError())
      .mockRejectedValueOnce(makeTransientError())
      .mockRejectedValueOnce(makeTransientError());

    await expect(appendRenewal({
      renewalId: "r1", tier: "adv", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    })).rejects.toThrow(/Premature close/);

    expect(mockAppend).toHaveBeenCalledTimes(5);
  });

  it("retries on EAI_AGAIN (DNS transient)", async () => {
    const err = new Error("getaddrinfo EAI_AGAIN");
    (err as Error & { code?: string }).code = "EAI_AGAIN";
    mockAppend.mockRejectedValueOnce(err).mockResolvedValueOnce({});

    await appendRenewal({
      renewalId: "r1", tier: "adv", year: 2026, firstName: "A", lastName: "B",
      email: "a@b.com", phone: "", pdEntries: [], amountCents: 15000,
      currency: "nzd", stripeSession: "cs_1", paymentStatus: "pending",
      createdAt: "2026-06-23T10:00:00.000Z",
    });

    expect(mockAppend).toHaveBeenCalledTimes(2);
  });
});
