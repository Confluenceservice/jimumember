import {
  appendToRange,
  ensureSheetWithHeaders,
  readRange,
  updateRange,
} from "./google-sheets-helpers";
import { logger } from "./logger";

/**
 * Durable subscription-state mirror in the `Memberships` sheet tab
 * (bug-scan finding #6 — replaces the ephemeral local-disk JSON store,
 * which was wiped on every Fly machine stop/deploy).
 *
 * Where truth lives: **Stripe is the source of truth** for subscription
 * existence and status — it is the system that bills. This sheet is the
 * durable mirror: it survives restarts, is visible to the volunteer admin,
 * and is fully reconstructible from Stripe via `bin/memberships-backfill.js`.
 * Financial idempotency does NOT depend on this mirror — subscription
 * creation keeps its Stripe idempotency key (`option_c_sub_<session.id>`);
 * the mirror row is a fast-path guard, not the safety mechanism.
 *
 * Status setters are UPSERTS: a missing row is created (partially populated)
 * and loudly logged (`membership_upsert_on_missing`) — a visible partial row
 * beats a silently dropped status transition; the backfill completes it.
 *
 * Concurrency: per-customer write serialisation via a promise chain,
 * mirroring the per-applicant pattern in apply.ts / upload-file.ts.
 * Per-process only — revisit before scaling beyond one machine.
 */

const SHEET_NAME = "Memberships";
const HEADERS = [
  "customer_id", // A
  "plan", // B
  "recurring_price_id", // C
  "status", // D
  "subscription_id", // E
  "next_anchor_epoch", // F
  "joined_at", // G
  "updated_at", // H
  "last_event", // I
  "provider", // J
] as const;

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
  /** Field name kept for call-site compatibility; semantically this is the
   *  configurable renewal anchor (RENEWAL_ANCHOR_MONTH/DAY), not always
   *  July 1. Matches the `next_july1_epoch` Stripe-metadata wire contract. */
  nextJuly1Epoch: number;
  joinedAt: string; // ISO
  /** Payment provider that owns this customer/subscription; "" on legacy (pre-017) rows. */
  provider: string;
}

// ---------------------------------------------------------------------------
// Sheet plumbing (transient retries live inside google-sheets-helpers)

let ensuredPromise: Promise<void> | null = null;

/**
 * `ensureSheetWithHeaders` only looks at A1, so a sheet created before the
 * provider column existed never gets its J1 header. Backfill it once,
 * best-effort: a failure must not block membership writes.
 */
async function backfillProviderHeader(): Promise<void> {
  try {
    const cell = await readRange(`'${SHEET_NAME}'!J1:J1`);
    const header = cell[0]?.[0];
    if (!header) {
      await updateRange(`'${SHEET_NAME}'!J1:J1`, [["provider"]]);
    } else if (header !== "provider") {
      // Column J used to be free for the admin; it now holds the provider id
      // and is overwritten by status changes. Say so loudly, once per process.
      logger.warn("membership_provider_column_not_empty", {
        header,
        hint: "Memberships column J is app-owned (provider); move any admin data out of it",
      });
    }
  } catch (err) {
    logger.warn("membership_provider_header_backfill_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function ensureSheet(): Promise<void> {
  if (!ensuredPromise) {
    ensuredPromise = ensureSheetWithHeaders(SHEET_NAME, HEADERS)
      .then(backfillProviderHeader)
      .catch((err) => {
        ensuredPromise = null; // allow retry on next call
        throw err;
      });
  }
  return ensuredPromise;
}

export function _resetMembershipsCacheForTesting(): void {
  ensuredPromise = null;
  customerQueues.clear();
}

function rowToRecord(row: string[]): MembershipRecord {
  return {
    customerId: row[0] ?? "",
    plan: row[1] ?? "",
    recurringPriceId: row[2] ?? "",
    status: (row[3] as MembershipStatus) || "awaiting_subscription",
    subscriptionId: row[4] || undefined,
    nextJuly1Epoch: Number(row[5] ?? 0),
    joinedAt: row[6] ?? "",
    provider: row[9] ?? "",
  };
}

function recordToRow(r: MembershipRecord, lastEvent: string | undefined): string[] {
  return [
    r.customerId,
    r.plan,
    r.recurringPriceId,
    r.status,
    r.subscriptionId ?? "",
    String(r.nextJuly1Epoch ?? 0),
    r.joinedAt,
    new Date().toISOString(), // updated_at — staleness visible to the admin
    lastEvent ?? "", // provenance: which provider event/session wrote this
    r.provider,
  ];
}

/** Returns the 1-based sheet row number for a customer, or null. Column A only. */
async function findRowNumber(customerId: string): Promise<number | null> {
  await ensureSheet();
  const ids = await readRange(`'${SHEET_NAME}'!A2:A`);
  const idx = ids.findIndex((r) => (r[0] ?? "").trim() === customerId);
  return idx === -1 ? null : idx + 2;
}

async function readRow(rowNumber: number): Promise<string[]> {
  const rows = await readRange(`'${SHEET_NAME}'!A${rowNumber}:J${rowNumber}`);
  return rows[0] ?? [];
}

async function writeRow(rowNumber: number, values: string[]): Promise<void> {
  await updateRange(`'${SHEET_NAME}'!A${rowNumber}:J${rowNumber}`, [values]);
}

async function appendRowValues(values: string[]): Promise<void> {
  await appendToRange(`'${SHEET_NAME}'!A1:J1`, values);
}

// ---------------------------------------------------------------------------
// Per-customer write serialisation. Webhooks for the same customer can arrive
// near-simultaneously (checkout.session.completed + customer.subscription.updated).

const customerQueues = new Map<string, Promise<void>>();

function serialised(customerId: string, op: () => Promise<void>): Promise<void> {
  const prev = customerQueues.get(customerId) ?? Promise.resolve();
  const next = prev.then(op, op); // run even if a prior op failed
  customerQueues.set(customerId, next.catch(() => undefined));
  return next;
}

// ---------------------------------------------------------------------------
// Public API — same names as the old store; every function is now async.

export async function getMembership(customerId: string): Promise<MembershipRecord | null> {
  const rowNumber = await findRowNumber(customerId);
  if (rowNumber === null) return null;
  return rowToRecord(await readRow(rowNumber));
}

export async function setAwaitingSubscription(
  customerId: string,
  data: Omit<MembershipRecord, "status" | "customerId">,
  lastEvent?: string,
): Promise<void> {
  return serialised(customerId, async () => {
    const record: MembershipRecord = {
      ...data,
      customerId,
      status: "awaiting_subscription",
    };
    const rowNumber = await findRowNumber(customerId);
    const row = recordToRow(record, lastEvent);
    if (rowNumber === null) await appendRowValues(row);
    else await writeRow(rowNumber, row);
  });
}

/**
 * Shared status-transition core with UPSERT semantics: a missing row is
 * created (partially populated) and loudly logged — never silently dropped.
 * This closes the second half of bug-scan #6 (the old setters were
 * no-op-on-missing, so after a store wipe every Stripe status transition
 * was dropped).
 */
async function setStatus(
  customerId: string,
  status: MembershipStatus,
  subscriptionId: string | undefined,
  lastEvent: string | undefined,
  provider: string | undefined,
): Promise<void> {
  return serialised(customerId, async () => {
    const rowNumber = await findRowNumber(customerId);
    if (rowNumber === null) {
      logger.warn("membership_upsert_on_missing", {
        customerId,
        status,
        subscriptionId,
        lastEvent,
        hint: "row created with partial data; run bin/memberships-backfill.js to complete",
      });
      const partial: MembershipRecord = {
        customerId,
        plan: "",
        recurringPriceId: "",
        status,
        subscriptionId,
        nextJuly1Epoch: 0,
        joinedAt: "",
        provider: provider ?? "",
      };
      await appendRowValues(recordToRow(partial, lastEvent));
      return;
    }
    const record = rowToRecord(await readRow(rowNumber));
    record.status = status;
    if (subscriptionId) record.subscriptionId = subscriptionId;
    record.provider = provider ?? record.provider;
    await writeRow(rowNumber, recordToRow(record, lastEvent));
  });
}

export async function setActive(
  customerId: string,
  subscriptionId: string,
  lastEvent?: string,
  provider?: string,
): Promise<void> {
  return setStatus(customerId, "active", subscriptionId, lastEvent, provider);
}

export async function setPaymentFailed(
  customerId: string,
  lastEvent?: string,
  provider?: string,
): Promise<void> {
  return setStatus(customerId, "payment_failed", undefined, lastEvent, provider);
}

export async function setCancelled(
  customerId: string,
  lastEvent?: string,
  provider?: string,
): Promise<void> {
  return setStatus(customerId, "cancelled", undefined, lastEvent, provider);
}

export async function hasActiveSubscription(customerId: string): Promise<boolean> {
  const record = await getMembership(customerId);
  return record?.status === "active" && !!record.subscriptionId;
}
