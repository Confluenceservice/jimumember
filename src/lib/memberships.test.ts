import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// In-memory emulation of the Memberships sheet, behind the shared
// google-sheets-helpers surface that memberships.ts consumes. Unlike the old
// test file (which re-implemented the store logic locally), this exercises
// the REAL module. Transient-retry behaviour is not re-tested here — it
// lives inside google-sheets-helpers and is covered by
// google-sheets-helpers.test.ts.
// ---------------------------------------------------------------------------

// vi.hoisted: these are referenced from the vi.mock factory below, which is
// hoisted above normal const initialisation (TDZ otherwise).
const { sheet, mockEnsureSheetWithHeaders, mockReadRange, mockUpdateRange, mockAppendToRange } =
  vi.hoisted(() => {
    const sheet: { rows: string[][]; ensured: string[] } = { rows: [], ensured: [] };

    const mockEnsureSheetWithHeaders = vi.fn(async (name: string, _headers: readonly string[]) => {
      sheet.ensured.push(name);
    });

    const mockReadRange = vi.fn(async (range: string): Promise<string[][]> => {
      if (/!A2:A$/.test(range)) {
        return sheet.rows.map((r) => [r[0] ?? ""]);
      }
      const m = range.match(/!A(\d+):I\1$/);
      if (m) {
        const row = sheet.rows[Number(m[1]) - 2];
        return row ? [row] : [];
      }
      throw new Error(`unexpected readRange in test: ${range}`);
    });

    const mockUpdateRange = vi.fn(async (range: string, values: unknown[][]) => {
      const m = range.match(/!A(\d+):I\1$/);
      if (!m) throw new Error(`unexpected updateRange in test: ${range}`);
      sheet.rows[Number(m[1]) - 2] = values[0] as string[];
    });

    const mockAppendToRange = vi.fn(async (_range: string, row: Array<string | number>) => {
      sheet.rows.push(row.map(String));
    });

    return { sheet, mockEnsureSheetWithHeaders, mockReadRange, mockUpdateRange, mockAppendToRange };
  });

vi.mock("./google-sheets-helpers", () => ({
  ensureSheetWithHeaders: mockEnsureSheetWithHeaders,
  readRange: mockReadRange,
  updateRange: mockUpdateRange,
  appendToRange: mockAppendToRange,
}));

const mockWarn = vi.fn();
vi.mock("./logger", () => ({
  logger: {
    warn: (...args: unknown[]) => mockWarn(...args),
    info: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  },
}));

import {
  getMembership,
  setAwaitingSubscription,
  setActive,
  setPaymentFailed,
  setCancelled,
  hasActiveSubscription,
  _resetMembershipsCacheForTesting,
} from "./memberships";

const BASE = {
  plan: "basic",
  recurringPriceId: "price_123",
  nextJuly1Epoch: 1751328000,
  joinedAt: "2026-03-23T12:00:00.000Z",
  subscriptionId: "sub_test456",
};

beforeEach(() => {
  sheet.rows = [];
  sheet.ensured = [];
  vi.clearAllMocks();
  _resetMembershipsCacheForTesting();
});

describe("setAwaitingSubscription", () => {
  it("lazily ensures the Memberships tab with headers on first-ever write", async () => {
    await setAwaitingSubscription("cus_test123", BASE, "cs_1");
    expect(mockEnsureSheetWithHeaders).toHaveBeenCalledWith(
      "Memberships",
      expect.arrayContaining(["customer_id", "status", "updated_at", "last_event"]),
    );
    expect(sheet.rows).toHaveLength(1);
  });

  it("stores a new record with awaiting_subscription status and provenance", async () => {
    await setAwaitingSubscription("cus_test123", BASE, "cs_evt_1");
    const record = await getMembership("cus_test123");
    expect(record).toMatchObject({
      customerId: "cus_test123",
      plan: "basic",
      recurringPriceId: "price_123",
      status: "awaiting_subscription",
      subscriptionId: "sub_test456",
    });
    // Column H (updated_at) is a fresh ISO timestamp; column I holds the event.
    expect(sheet.rows[0][7]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sheet.rows[0][8]).toBe("cs_evt_1");
  });

  it("overwrites in place (no duplicate row) when the customer already exists", async () => {
    await setAwaitingSubscription("cus_test123", BASE);
    await setAwaitingSubscription("cus_test123", { ...BASE, plan: "advanced" });
    expect(sheet.rows).toHaveLength(1);
    expect((await getMembership("cus_test123"))?.plan).toBe("advanced");
  });
});

describe("getMembership", () => {
  it("round-trips all fields", async () => {
    await setAwaitingSubscription("cus_rt", BASE);
    const r = await getMembership("cus_rt");
    expect(r).toEqual({
      customerId: "cus_rt",
      plan: "basic",
      recurringPriceId: "price_123",
      status: "awaiting_subscription",
      subscriptionId: "sub_test456",
      nextJuly1Epoch: 1751328000,
      joinedAt: "2026-03-23T12:00:00.000Z",
    });
  });

  it("returns null for unknown customer", async () => {
    expect(await getMembership("cus_unknown")).toBeNull();
  });
});

describe("setActive", () => {
  it("updates status + subscriptionId + updated_at on an existing row", async () => {
    await setAwaitingSubscription("cus_test123", { ...BASE, subscriptionId: undefined });
    const before = sheet.rows[0][7];
    await new Promise((r) => setTimeout(r, 2));
    await setActive("cus_test123", "sub_new789", "evt_2");
    const record = await getMembership("cus_test123");
    expect(record?.status).toBe("active");
    expect(record?.subscriptionId).toBe("sub_new789");
    expect(sheet.rows[0][8]).toBe("evt_2");
    expect(sheet.rows[0][7] >= before).toBe(true);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("UPSERTS on a missing row and logs membership_upsert_on_missing (regression: silent drop)", async () => {
    await setActive("cus_wiped", "sub_xyz", "evt_3");
    expect(mockWarn).toHaveBeenCalledWith(
      "membership_upsert_on_missing",
      expect.objectContaining({ customerId: "cus_wiped", status: "active" }),
    );
    const record = await getMembership("cus_wiped");
    expect(record?.status).toBe("active");
    expect(record?.subscriptionId).toBe("sub_xyz");
  });
});

describe("setPaymentFailed", () => {
  it("updates status on an existing row", async () => {
    await setAwaitingSubscription("cus_test123", BASE);
    await setActive("cus_test123", "sub_active");
    await setPaymentFailed("cus_test123", "in_1");
    expect((await getMembership("cus_test123"))?.status).toBe("payment_failed");
    // subscriptionId survives a failed-payment transition
    expect((await getMembership("cus_test123"))?.subscriptionId).toBe("sub_active");
  });

  it("UPSERTS on a missing row and warns (regression: silent drop)", async () => {
    await setPaymentFailed("cus_gone", "in_2");
    expect(mockWarn).toHaveBeenCalledWith(
      "membership_upsert_on_missing",
      expect.objectContaining({ customerId: "cus_gone", status: "payment_failed" }),
    );
    expect((await getMembership("cus_gone"))?.status).toBe("payment_failed");
  });
});

describe("setCancelled", () => {
  it("updates status on an existing row", async () => {
    await setAwaitingSubscription("cus_test123", BASE);
    await setCancelled("cus_test123", "sub_del");
    expect((await getMembership("cus_test123"))?.status).toBe("cancelled");
  });

  it("UPSERTS on a missing row and warns (regression: silent drop)", async () => {
    await setCancelled("cus_lost", "sub_del2");
    expect(mockWarn).toHaveBeenCalledWith(
      "membership_upsert_on_missing",
      expect.objectContaining({ customerId: "cus_lost", status: "cancelled" }),
    );
    expect((await getMembership("cus_lost"))?.status).toBe("cancelled");
  });
});

describe("hasActiveSubscription", () => {
  it("returns true for active status with subscriptionId", async () => {
    await setAwaitingSubscription("cus_active", BASE);
    await setActive("cus_active", "sub_abc");
    expect(await hasActiveSubscription("cus_active")).toBe(true);
  });

  it("returns false for awaiting_subscription without subscriptionId", async () => {
    await setAwaitingSubscription("cus_awaiting", { ...BASE, subscriptionId: undefined });
    expect(await hasActiveSubscription("cus_awaiting")).toBe(false);
  });

  it("returns false for payment_failed status", async () => {
    await setAwaitingSubscription("cus_failed", BASE);
    await setActive("cus_failed", "sub_f");
    await setPaymentFailed("cus_failed");
    expect(await hasActiveSubscription("cus_failed")).toBe(false);
  });

  it("returns false for unknown customer", async () => {
    expect(await hasActiveSubscription("cus_unknown")).toBe(false);
  });
});

describe("per-customer write serialisation", () => {
  it("interleaved writes for one customer run strictly in order", async () => {
    // Make the first write slow: hold its append until released.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    mockAppendToRange.mockImplementationOnce(async (_range, row) => {
      await gate;
      order.push("first");
      sheet.rows.push(row.map(String));
    });

    const p1 = setAwaitingSubscription("cus_race", BASE, "evt_first");
    const p2 = setActive("cus_race", "sub_second", "evt_second").then(() =>
      order.push("second"),
    );

    // Give the second op a chance to (incorrectly) jump the queue.
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]);

    release();
    await Promise.all([p1, p2]);
    expect(order).toEqual(["first", "second"]);
    // The second op saw the row the first created — one row, active status.
    expect(sheet.rows).toHaveLength(1);
    const record = await getMembership("cus_race");
    expect(record?.status).toBe("active");
    expect(record?.subscriptionId).toBe("sub_second");
    expect(mockWarn).not.toHaveBeenCalled(); // no upsert-on-missing fired
  });

  it("a failed op does not wedge the customer queue", async () => {
    mockAppendToRange.mockRejectedValueOnce(new Error("boom"));
    await expect(setAwaitingSubscription("cus_err", BASE)).rejects.toThrow("boom");
    await setActive("cus_err", "sub_after_err");
    expect((await getMembership("cus_err"))?.status).toBe("active");
  });
});
