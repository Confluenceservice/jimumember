import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), ".data");
const MEMBERSHIPS_FILE = join(DATA_DIR, "memberships.json");

export type MembershipStatus =
  | "awaiting_subscription"
  | "active"
  | "payment_failed"
  | "cancelled";

export interface MembershipRecord {
  customerId: string;
  plan: string;
  recurringPriceId: string;
  status: MembershipStatus;
  subscriptionId?: string;
  nextJuly1Epoch: number;
  joinedAt: string; // ISO string
}

type MembershipStore = Record<string, MembershipRecord>;

function ensureDataDir(): void {
  const { mkdirSync } = require("node:fs");
  mkdirSync(DATA_DIR, { recursive: true });
}

function loadStore(): MembershipStore {
  try {
    return JSON.parse(readFileSync(MEMBERSHIPS_FILE, "utf-8")) as MembershipStore;
  } catch {
    return {};
  }
}

function saveStore(store: MembershipStore): void {
  ensureDataDir();
  writeFileSync(MEMBERSHIPS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export function getMembership(customerId: string): MembershipRecord | null {
  const store = loadStore();
  return store[customerId] ?? null;
}

export function setAwaitingSubscription(
  customerId: string,
  data: Omit<MembershipRecord, "status" | "customerId">,
): void {
  const store = loadStore();
  store[customerId] = {
    ...data,
    customerId,
    status: "awaiting_subscription",
  };
  saveStore(store);
}

export function setActive(customerId: string, subscriptionId: string): void {
  const store = loadStore();
  if (store[customerId]) {
    store[customerId].status = "active";
    store[customerId].subscriptionId = subscriptionId;
    saveStore(store);
  }
}

export function setPaymentFailed(customerId: string): void {
  const store = loadStore();
  if (store[customerId]) {
    store[customerId].status = "payment_failed";
    saveStore(store);
  }
}

export function setCancelled(customerId: string): void {
  const store = loadStore();
  if (store[customerId]) {
    store[customerId].status = "cancelled";
    saveStore(store);
  }
}

export function hasActiveSubscription(customerId: string): boolean {
  const record = getMembership(customerId);
  return record?.status === "active" && !!record.subscriptionId;
}
