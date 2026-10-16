import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnsureSheetWithHeaders,
  mockReadDataRows,
  mockAppendToRange,
  mockUpdateRange,
} = vi.hoisted(() => ({
  mockEnsureSheetWithHeaders: vi.fn(),
  mockReadDataRows: vi.fn(),
  mockAppendToRange: vi.fn(),
  mockUpdateRange: vi.fn(),
}));

vi.mock("./google-sheets-helpers", async () => {
  const actual = await vi.importActual<typeof import("./google-sheets-helpers")>(
    "./google-sheets-helpers",
  );
  return {
    _resetSheetsClientCacheForTesting: vi.fn(),
    columnLetter: actual.columnLetter,
    ensureSheetWithHeaders: mockEnsureSheetWithHeaders,
    readDataRows: mockReadDataRows,
    appendToRange: mockAppendToRange,
    updateRange: mockUpdateRange,
  };
});

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  HEADERS,
  appendPending,
  findByStripeId,
  listPending,
  markAttemptFailed,
  markDone,
  type XeroSyncRecord,
} from "./xero-sync-sheet";

const RECORD: XeroSyncRecord = {
  stripeId: "cs_test_123",
  eventType: "checkout.session.completed",
  flow: "advanced_new",
  internalId: "app_1",
  email: "member@example.com",
  contactName: "A Member",
  amountCents: 12000,
  currency: "nzd",
  paidAt: "2026-08-09T02:00:00.000Z",
  feeCents: 378,
  livemode: true,
};

/** A stored row for `stripeId`, with optional column overrides. */
function row(stripeId: string, overrides: Record<number, string> = {}): string[] {
  const base = [
    stripeId,
    "checkout.session.completed",
    "advanced_new",
    "app_1",
    "member@example.com",
    "A Member",
    "12000",
    "nzd",
    "2026-08-09T02:00:00.000Z",
    "378",
    "pending",
    "",
    "",
    "",
    "0",
    "",
    "2026-08-09T02:00:01.000Z",
    "TRUE",
  ];
  for (const [i, v] of Object.entries(overrides)) base[Number(i)] = v;
  return base;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureSheetWithHeaders.mockResolvedValue(undefined);
  mockAppendToRange.mockResolvedValue(undefined);
  mockUpdateRange.mockResolvedValue(undefined);
  mockReadDataRows.mockResolvedValue([]);
});

describe("schema", () => {
  it("has 18 columns ending in livemode", () => {
    expect(HEADERS).toHaveLength(18);
    expect(HEADERS[0]).toBe("stripe_id");
    expect(HEADERS[10]).toBe("status");
    expect(HEADERS[17]).toBe("livemode");
  });
});

describe("findByStripeId", () => {
  it("locates the row and reports its 1-indexed sheet position", async () => {
    mockReadDataRows.mockResolvedValueOnce([row("cs_other"), row("cs_test_123")]);

    const found = await findByStripeId("cs_test_123");

    // Second data row => sheet row 3 (header occupies row 1).
    expect(found?.rowNumber).toBe(3);
    expect(found?.amountCents).toBe(12000);
    expect(found?.livemode).toBe(true);
  });

  it("returns null when absent", async () => {
    mockReadDataRows.mockResolvedValueOnce([row("cs_other")]);
    expect(await findByStripeId("cs_test_123")).toBeNull();
  });

  it("fails open to null when the read throws", async () => {
    mockReadDataRows.mockRejectedValueOnce(new Error("Sheet 503"));
    expect(await findByStripeId("cs_test_123")).toBeNull();
  });

  it("reads livemode case-insensitively, like other flags in this codebase", async () => {
    mockReadDataRows.mockResolvedValueOnce([row("cs_test_123", { 17: "true" })]);
    expect((await findByStripeId("cs_test_123"))?.livemode).toBe(true);

    mockReadDataRows.mockResolvedValueOnce([row("cs_test_123", { 17: "FALSE" })]);
    expect((await findByStripeId("cs_test_123"))?.livemode).toBe(false);
  });

  it("treats an unrecognised status as pending rather than silently done", async () => {
    mockReadDataRows.mockResolvedValueOnce([row("cs_test_123", { 10: "" })]);
    expect((await findByStripeId("cs_test_123"))?.status).toBe("pending");
  });
});

describe("appendPending", () => {
  it("writes all 18 columns with status pending and attempts 0", async () => {
    await appendPending(RECORD);

    expect(mockAppendToRange).toHaveBeenCalledTimes(1);
    const [range, values] = mockAppendToRange.mock.calls[0];
    expect(range).toBe("'Xero Sync'!A1:R1");
    expect(values).toHaveLength(18);
    expect(values[0]).toBe("cs_test_123");
    expect(values[10]).toBe("pending");
    expect(values[14]).toBe(0);
    expect(values[17]).toBe("TRUE");
  });

  it("is a no-op when the Stripe id is already recorded", async () => {
    // A Stripe replay carrying a NEW event.id slips past the webhook dedup,
    // so this is the gate that stops a second enqueue.
    mockReadDataRows.mockResolvedValueOnce([row("cs_test_123")]);

    await appendPending(RECORD);

    expect(mockAppendToRange).not.toHaveBeenCalled();
  });

  it("swallows write failures so the webhook is never blocked", async () => {
    mockAppendToRange.mockRejectedValueOnce(new Error("Sheet 503"));
    await expect(appendPending(RECORD)).resolves.toBeUndefined();
  });

  it("stores livemode FALSE for test-mode events", async () => {
    await appendPending({ ...RECORD, livemode: false });
    expect(mockAppendToRange.mock.calls[0][1][17]).toBe("FALSE");
  });
});

describe("markDone", () => {
  it("updates only the mutable K..Q block of the located row", async () => {
    mockReadDataRows.mockResolvedValueOnce([row("cs_test_123")]);

    await markDone("cs_test_123", { contactId: "c1", invoiceId: "i1", paymentId: "p1" });

    const [range, values] = mockUpdateRange.mock.calls[0];
    expect(range).toBe("'Xero Sync'!K2:Q2");
    expect(values[0][0]).toBe("done");
    expect(values[0].slice(1, 4)).toEqual(["c1", "i1", "p1"]);
    expect(values[0][5]).toBe(""); // last_error cleared
  });

  it("preserves ids the caller did not supply", async () => {
    mockReadDataRows.mockResolvedValueOnce([row("cs_test_123", { 11: "c_existing" })]);

    await markDone("cs_test_123", { invoiceId: "i1", paymentId: "p1" });

    expect(mockUpdateRange.mock.calls[0][1][0][1]).toBe("c_existing");
  });

  it("swallows failures — safe ONLY because pushOne re-checks Xero first", async () => {
    mockReadDataRows.mockResolvedValueOnce([row("cs_test_123")]);
    mockUpdateRange.mockRejectedValueOnce(new Error("Sheet 503"));

    await expect(markDone("cs_test_123", { invoiceId: "i1" })).resolves.toBeUndefined();
  });

  it("does not write when the row cannot be found", async () => {
    mockReadDataRows.mockResolvedValueOnce([]);

    await markDone("cs_test_123", { invoiceId: "i1" });

    expect(mockUpdateRange).not.toHaveBeenCalled();
  });
});

describe("markAttemptFailed", () => {
  it("keeps a transient failure pending and increments attempts", async () => {
    mockReadDataRows.mockResolvedValueOnce([row("cs_test_123", { 14: "2" })]);

    await markAttemptFailed("cs_test_123", "XERO_API_503", false);

    const values = mockUpdateRange.mock.calls[0][1][0];
    expect(values[0]).toBe("pending");
    expect(values[4]).toBe(3);
    expect(values[5]).toBe("XERO_API_503");
  });

  it("moves a permanent failure out of the sweeper's reach", async () => {
    mockReadDataRows.mockResolvedValueOnce([row("cs_test_123")]);

    await markAttemptFailed("cs_test_123", "XERO_API_400 bad account", true);

    expect(mockUpdateRange.mock.calls[0][1][0][0]).toBe("failed_permanent");
  });

  it("truncates a huge error rather than writing it whole", async () => {
    mockReadDataRows.mockResolvedValueOnce([row("cs_test_123")]);

    await markAttemptFailed("cs_test_123", "x".repeat(5000), false);

    expect(mockUpdateRange.mock.calls[0][1][0][5]).toHaveLength(500);
  });
});

describe("listPending", () => {
  it("returns only pending rows, capped at the limit", async () => {
    mockReadDataRows.mockResolvedValueOnce([
      row("cs_1"),
      row("cs_2", { 10: "done" }),
      row("cs_3", { 10: "failed_permanent" }),
      row("cs_4"),
    ]);

    const pending = await listPending(10);

    expect(pending.map((r) => r.stripeId)).toEqual(["cs_1", "cs_4"]);
  });

  it("honours the limit", async () => {
    mockReadDataRows.mockResolvedValueOnce([row("cs_1"), row("cs_2"), row("cs_3")]);
    expect(await listPending(2)).toHaveLength(2);
  });

  it("fails open to an empty list", async () => {
    mockReadDataRows.mockRejectedValueOnce(new Error("Sheet 503"));
    expect(await listPending()).toEqual([]);
  });
});
