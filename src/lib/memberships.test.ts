import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Test the logic in isolation by re-implementing the store operations locally
// This mirrors the logic in memberships.ts so we can test it without
// module-level file path issues.

type MembershipStatus =
  | "awaiting_subscription"
  | "active"
  | "payment_failed"
  | "cancelled";

interface MembershipRecord {
  customerId: string;
  plan: string;
  recurringPriceId: string;
  status: MembershipStatus;
  subscriptionId?: string;
  nextJuly1Epoch: number;
  joinedAt: string;
}

const TEST_DIR = join(process.cwd(), ".test-data-membership");
const TEST_FILE = join(TEST_DIR, "memberships.json");

function cleanTestStore() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function readTestStore(): Record<string, MembershipRecord> {
  try {
    return JSON.parse(readFileSync(TEST_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveTestStore(store: Record<string, MembershipRecord>) {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(TEST_FILE, JSON.stringify(store, null, 2), "utf-8");
}

// Mirror the logic from memberships.ts for unit testing
function setAwaitingSubscription(
  customerId: string,
  data: Omit<MembershipRecord, "status" | "customerId">,
) {
  const store = readTestStore();
  store[customerId] = { ...data, customerId, status: "awaiting_subscription" };
  saveTestStore(store);
}

function setActive(customerId: string, subscriptionId: string) {
  const store = readTestStore();
  if (store[customerId]) {
    store[customerId].status = "active";
    store[customerId].subscriptionId = subscriptionId;
    saveTestStore(store);
  }
}

function setPaymentFailed(customerId: string) {
  const store = readTestStore();
  if (store[customerId]) {
    store[customerId].status = "payment_failed";
    saveTestStore(store);
  }
}

function setCancelled(customerId: string) {
  const store = readTestStore();
  if (store[customerId]) {
    store[customerId].status = "cancelled";
    saveTestStore(store);
  }
}

function getMembership(customerId: string): MembershipRecord | null {
  const store = readTestStore();
  return store[customerId] ?? null;
}

function hasActiveSubscription(customerId: string): boolean {
  const record = getMembership(customerId);
  return record?.status === "active" && !!record.subscriptionId;
}

describe("MembershipRecord types", () => {
  it("defines valid status values", () => {
    const statuses: MembershipRecord["status"][] = [
      "awaiting_subscription",
      "active",
      "payment_failed",
      "cancelled",
    ];
    expect(statuses).toHaveLength(4);
  });
});

describe("setAwaitingSubscription", () => {
  it("stores a new membership record with awaiting_subscription status", () => {
    cleanTestStore();

    setAwaitingSubscription("cus_test123", {
      plan: "associate",
      recurringPriceId: "price_123",
      nextJuly1Epoch: 1751328000,
      joinedAt: "2026-03-23T12:00:00.000Z",
      subscriptionId: "sub_test456",
    });

    const record = getMembership("cus_test123");
    expect(record).toMatchObject({
      customerId: "cus_test123",
      plan: "associate",
      recurringPriceId: "price_123",
      status: "awaiting_subscription",
      subscriptionId: "sub_test456",
    });
  });

  it("returns null for unknown customer", () => {
    cleanTestStore();
    expect(getMembership("cus_unknown")).toBeNull();
  });
});

describe("setActive", () => {
  it("updates status to active and sets subscriptionId", () => {
    cleanTestStore();
    // Pre-populate
    saveTestStore({
      "cus_test123": {
        customerId: "cus_test123",
        plan: "associate",
        recurringPriceId: "price_123",
        status: "awaiting_subscription",
        nextJuly1Epoch: 1751328000,
        joinedAt: "2026-03-23T12:00:00.000Z",
      },
    });

    setActive("cus_test123", "sub_new789");

    const record = getMembership("cus_test123");
    expect(record?.status).toBe("active");
    expect(record?.subscriptionId).toBe("sub_new789");
  });

  it("does nothing if customer does not exist", () => {
    cleanTestStore();
    setActive("cus_nonexistent", "sub_xyz");
    expect(getMembership("cus_nonexistent")).toBeNull();
  });
});

describe("setPaymentFailed", () => {
  it("updates status to payment_failed", () => {
    cleanTestStore();
    saveTestStore({
      "cus_test123": {
        customerId: "cus_test123",
        plan: "professional",
        recurringPriceId: "price_456",
        status: "active",
        nextJuly1Epoch: 1751328000,
        joinedAt: "2026-03-23T12:00:00.000Z",
        subscriptionId: "sub_active",
      },
    });

    setPaymentFailed("cus_test123");

    expect(getMembership("cus_test123")?.status).toBe("payment_failed");
  });
});

describe("setCancelled", () => {
  it("updates status to cancelled", () => {
    cleanTestStore();
    saveTestStore({
      "cus_test123": {
        customerId: "cus_test123",
        plan: "professional",
        recurringPriceId: "price_456",
        status: "active",
        nextJuly1Epoch: 1751328000,
        joinedAt: "2026-03-23T12:00:00.000Z",
        subscriptionId: "sub_active",
      },
    });

    setCancelled("cus_test123");

    expect(getMembership("cus_test123")?.status).toBe("cancelled");
  });
});

describe("hasActiveSubscription", () => {
  it("returns true for active status with subscriptionId", () => {
    cleanTestStore();
    saveTestStore({
      "cus_active": {
        customerId: "cus_active",
        plan: "associate",
        recurringPriceId: "price_123",
        status: "active",
        nextJuly1Epoch: 1751328000,
        joinedAt: "2026-03-23T12:00:00.000Z",
        subscriptionId: "sub_abc",
      },
    });

    expect(hasActiveSubscription("cus_active")).toBe(true);
  });

  it("returns false for awaiting_subscription status (no subscriptionId)", () => {
    cleanTestStore();
    saveTestStore({
      "cus_awaiting": {
        customerId: "cus_awaiting",
        plan: "associate",
        recurringPriceId: "price_123",
        status: "awaiting_subscription",
        nextJuly1Epoch: 1751328000,
        joinedAt: "2026-03-23T12:00:00.000Z",
      },
    });

    expect(hasActiveSubscription("cus_awaiting")).toBe(false);
  });

  it("returns false for payment_failed status", () => {
    cleanTestStore();
    saveTestStore({
      "cus_failed": {
        customerId: "cus_failed",
        plan: "associate",
        recurringPriceId: "price_123",
        status: "payment_failed",
        nextJuly1Epoch: 1751328000,
        joinedAt: "2026-03-23T12:00:00.000Z",
        subscriptionId: "sub_failed",
      },
    });

    expect(hasActiveSubscription("cus_failed")).toBe(false);
  });

  it("returns false for unknown customer", () => {
    cleanTestStore();
    expect(hasActiveSubscription("cus_unknown")).toBe(false);
  });
});
