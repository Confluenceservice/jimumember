import {
  _resetSheetsClientCacheForTesting,
  appendToRange,
  columnLetter,
  ensureSheetWithHeaders,
  readDataRows,
  updateRange,
} from "./google-sheets-helpers";
import { logger } from "./logger";
import { CURRENCY } from "./config";

/**
 * The "Xero Sync" tab: simultaneously the queue, the idempotency gate, and
 * the debugging join key for every Stripe payment pushed to Xero.
 *
 * Why a sheet tab and not a real queue: fly.toml runs one 256 MB machine
 * with `min_machines_running = 0` and `auto_stop_machines = 'stop'`, so a
 * detached promise scheduled after the webhook response may never run.
 * There is no Redis, no worker. This is the same failure class as the
 * existing appendCheckoutLog tab.
 *
 * Schema (A-R). A-Q are the plan's columns; R was added because
 * sweepPending cannot otherwise honour the livemode environment guard when
 * re-driving a row it did not itself just receive:
 *   A stripe_id       PRIMARY idempotency key (cs_... or in_...)
 *   B event_type      checkout.session.completed | invoice.payment_succeeded
 *   C flow            advanced_new | basic_new | renewal | auto_renewal
 *   D internal_id     applicant_id | basic_application_id | renewal_id
 *   E email           normalised lowercase — the Contact key
 *   F contact_name
 *   G amount_cents    Stripe gross
 *   H currency
 *   I paid_at         ISO, from the BALANCE TRANSACTION, not Date.now()
 *   J fee_cents       logged for reconciliation; bank rules do the accounting
 *   K status          pending | done | failed_permanent
 *   L xero_contact_id
 *   M xero_invoice_id
 *   N xero_payment_id
 *   O attempts
 *   P last_error      truncated to 500 chars
 *   Q updated_at
 *   R livemode        "TRUE" | "FALSE" — the Stripe event's livemode
 *
 * FAILURE CONTRACT
 * Reads fail open (null / []), matching the other sheet-backed readers.
 *
 * Writes log and swallow — including markDone. That is only safe BECAUSE
 * xero-sync.pushOne re-checks Xero (findInvoiceByNumber, then AmountDue)
 * before creating anything: a swallowed markDone leaves a row that is done
 * in Xero but pending here, which the sweeper will re-drive and which must
 * therefore be a no-op. Do NOT keep markDone swallowing if that recovery
 * path is ever removed.
 */

const SHEET_NAME = "Xero Sync";

export const HEADERS = [
  "stripe_id",
  "event_type",
  "flow",
  "internal_id",
  "email",
  "contact_name",
  "amount_cents",
  "currency",
  "paid_at",
  "fee_cents",
  "status",
  "xero_contact_id",
  "xero_invoice_id",
  "xero_payment_id",
  "attempts",
  "last_error",
  "updated_at",
  "livemode",
] as const;

/** Column indexes into a data row. */
const COL = {
  stripeId: 0,
  eventType: 1,
  flow: 2,
  internalId: 3,
  email: 4,
  contactName: 5,
  amountCents: 6,
  currency: 7,
  paidAt: 8,
  feeCents: 9,
  status: 10,
  contactId: 11,
  invoiceId: 12,
  paymentId: 13,
  attempts: 14,
  lastError: 15,
  updatedAt: 16,
  livemode: 17,
} as const;

/** K..Q — the mutable block. livemode (R) is written once, at append. */
const MUTABLE_FIRST_COL = COL.status + 1; // 11 => K
const MUTABLE_LAST_COL = COL.updatedAt + 1; // 17 => Q

const MAX_ERROR_CHARS = 500;

export { _resetSheetsClientCacheForTesting };

export type XeroSyncStatus = "pending" | "done" | "failed_permanent";

/**
 * The four payment shapes the webhook can hand us. Written verbatim into
 * column C, so these strings are a production contract — a fork that renames
 * one strands every existing row. `advanced_` / `basic_` track the tier slugs
 * in `forms/tiers.ts`; `auto_renewal` covers both tiers because the deferred
 * subscription (`invoice.payment_succeeded`) is tier-agnostic.
 */
export type XeroSyncFlow = "advanced_new" | "basic_new" | "renewal" | "auto_renewal";

export interface XeroSyncRecord {
  stripeId: string;
  eventType: string;
  flow: XeroSyncFlow;
  internalId: string;
  email: string;
  contactName: string;
  amountCents: number;
  currency: string;
  paidAt: string;
  feeCents: number;
  livemode: boolean;
}

export interface XeroSyncRow extends XeroSyncRecord {
  status: XeroSyncStatus;
  xeroContactId: string;
  xeroInvoiceId: string;
  xeroPaymentId: string;
  attempts: number;
  lastError: string;
  /** 1-indexed spreadsheet row, so callers can target it with updateRange. */
  rowNumber: number;
}

function parseRow(row: string[], rowNumber: number): XeroSyncRow {
  const status = (row[COL.status] ?? "").trim().toLowerCase();
  return {
    stripeId: row[COL.stripeId] ?? "",
    eventType: row[COL.eventType] ?? "",
    flow: (row[COL.flow] ?? "") as XeroSyncFlow,
    internalId: row[COL.internalId] ?? "",
    email: row[COL.email] ?? "",
    contactName: row[COL.contactName] ?? "",
    amountCents: Number(row[COL.amountCents] ?? 0) || 0,
    currency: row[COL.currency] || CURRENCY,
    paidAt: row[COL.paidAt] ?? "",
    feeCents: Number(row[COL.feeCents] ?? 0) || 0,
    // Flags are written by us as "TRUE"/"FALSE" but admins edit these tabs
    // by hand, so read case-insensitively like the rest of the codebase.
    livemode: (row[COL.livemode] ?? "").trim().toLowerCase() === "true",
    status: (status === "done" || status === "failed_permanent"
      ? status
      : "pending") as XeroSyncStatus,
    xeroContactId: row[COL.contactId] ?? "",
    xeroInvoiceId: row[COL.invoiceId] ?? "",
    xeroPaymentId: row[COL.paymentId] ?? "",
    attempts: Number(row[COL.attempts] ?? 0) || 0,
    lastError: row[COL.lastError] ?? "",
    rowNumber,
  };
}

async function readAll(): Promise<XeroSyncRow[]> {
  await ensureSheetWithHeaders(SHEET_NAME, HEADERS);
  const rows = await readDataRows(SHEET_NAME, HEADERS);
  // +2: one for the header row, one because sheets are 1-indexed.
  return rows.map((row, i) => parseRow(row, i + 2));
}

/** The row for a Stripe id, or null if absent / the read failed. */
export async function findByStripeId(stripeId: string): Promise<XeroSyncRow | null> {
  if (!stripeId) return null;
  try {
    const rows = await readAll();
    return rows.find((r) => r.stripeId === stripeId) ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("xero_sync_sheet.find_failed_fail_open", { stripeId, error: msg });
    return null;
  }
}

/**
 * Records a payment as pending. A no-op when the Stripe id is already
 * present, so a Stripe replay carrying a fresh event.id (which the webhook
 * dedup would not catch) cannot enqueue the same payment twice.
 */
export async function appendPending(record: XeroSyncRecord): Promise<void> {
  if (!record.stripeId) return;
  try {
    const existing = await findByStripeId(record.stripeId);
    if (existing) {
      logger.info("xero_sync_sheet.append_skip_already_present", {
        stripeId: record.stripeId,
        status: existing.status,
      });
      return;
    }
    await ensureSheetWithHeaders(SHEET_NAME, HEADERS);
    const now = new Date().toISOString();
    await appendToRange(`'${SHEET_NAME}'!A1:${columnLetter(HEADERS.length)}1`, [
      record.stripeId,
      record.eventType,
      record.flow,
      record.internalId,
      record.email,
      record.contactName,
      record.amountCents,
      record.currency,
      record.paidAt,
      record.feeCents,
      "pending",
      "",
      "",
      "",
      0,
      "",
      now,
      record.livemode ? "TRUE" : "FALSE",
    ]);
    logger.info("xero_sync_sheet.append_pending", {
      stripeId: record.stripeId,
      flow: record.flow,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("xero_sync_sheet.append_failed", { stripeId: record.stripeId, error: msg });
  }
}

/** Writes the mutable K..Q block for an already-located row. */
async function writeMutableBlock(
  rowNumber: number,
  values: [string, string, string, string, number, string, string],
): Promise<void> {
  const range = `'${SHEET_NAME}'!${columnLetter(MUTABLE_FIRST_COL)}${rowNumber}:${columnLetter(
    MUTABLE_LAST_COL,
  )}${rowNumber}`;
  await updateRange(range, [values]);
}

export interface XeroIds {
  contactId?: string;
  invoiceId?: string;
  paymentId?: string;
}

/**
 * Marks a row done. Swallows failures — see the module-level contract: this
 * is only safe because pushOne re-checks Xero before creating anything, so
 * a re-drive of a row left pending is a no-op.
 */
export async function markDone(stripeId: string, ids: XeroIds): Promise<void> {
  try {
    const row = await findByStripeId(stripeId);
    if (!row) {
      logger.warn("xero_sync_sheet.mark_done_row_missing", { stripeId });
      return;
    }
    await writeMutableBlock(row.rowNumber, [
      "done",
      ids.contactId ?? row.xeroContactId,
      ids.invoiceId ?? row.xeroInvoiceId,
      ids.paymentId ?? row.xeroPaymentId,
      row.attempts,
      "",
      new Date().toISOString(),
    ]);
    logger.info("xero_sync_sheet.mark_done", { stripeId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("xero_sync_sheet.mark_done_failed", { stripeId, error: msg });
  }
}

/**
 * Records a failed attempt. `permanent` moves the row out of the sweeper's
 * reach entirely — reserved for XeroApiError.permanent (payload bugs that
 * would fail identically forever).
 */
export async function markAttemptFailed(
  stripeId: string,
  error: string,
  permanent: boolean,
  ids: XeroIds = {},
): Promise<void> {
  try {
    const row = await findByStripeId(stripeId);
    if (!row) {
      logger.warn("xero_sync_sheet.mark_failed_row_missing", { stripeId, error });
      return;
    }
    await writeMutableBlock(row.rowNumber, [
      permanent ? "failed_permanent" : "pending",
      ids.contactId ?? row.xeroContactId,
      ids.invoiceId ?? row.xeroInvoiceId,
      ids.paymentId ?? row.xeroPaymentId,
      row.attempts + 1,
      error.slice(0, MAX_ERROR_CHARS),
      new Date().toISOString(),
    ]);
    logger.warn("xero_sync_sheet.mark_attempt_failed", {
      stripeId,
      permanent,
      attempts: row.attempts + 1,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("xero_sync_sheet.mark_failed_write_failed", { stripeId, error: msg });
  }
}

/** Pending rows for the sweeper, oldest first. Fails open to []. */
export async function listPending(limit = 20): Promise<XeroSyncRow[]> {
  try {
    const rows = await readAll();
    return rows.filter((r) => r.status === "pending").slice(0, limit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("xero_sync_sheet.list_pending_failed_fail_open", { error: msg });
    return [];
  }
}
