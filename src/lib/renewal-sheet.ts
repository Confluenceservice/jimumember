import { listTiers } from "./forms/tiers";
import { CURRENCY } from "./config";
import {
  appendRow,
  readRange,
  updateRange,
  _resetSheetsClientCacheForTesting,
} from "./google-sheets-helpers";

export interface PdEntry {
  dateCompleted: string;
  activity: string;
  totalHours: number;
  provider: string;
}

export interface RenewalInput {
  renewalId: string;
  /** TierConfig.storageValue — phase K widened from "pm"|"am" literal to
   *  string so any TierConfig entry can be written without code changes. */
  tier: string;
  year: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  pdEntries: PdEntry[];
  amountCents: number;
  currency: string;
  stripeSession: string;
  paymentStatus: "pending";
  createdAt: string;
}

export interface RenewalRow {
  renewalId: string;
  tier: string;
  renewalYear: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  pdEntries: PdEntry[];
  amountPaidCents: number;
  currency: string;
  paymentStatus: "pending" | "paid";
  stripeSession: string;
  createdAt: string;
  paidAt: string;
}

const RENEWAL_HEADERS = [
  "renewal_id", "tier", "renewal_year",
  "first_name", "last_name", "email", "phone",
  "pd_entries", "amount_paid_cents", "currency",
  "payment_status", "stripe_session", "created_at", "paid_at",
] as const;

const SHEET_NAME = "Renewals";

export { _resetSheetsClientCacheForTesting };

export async function appendRenewal(input: RenewalInput): Promise<void> {
  const row = [
    input.renewalId,
    input.tier,
    String(input.year),
    input.firstName,
    input.lastName,
    input.email,
    input.phone,
    JSON.stringify(input.pdEntries),
    String(input.amountCents),
    input.currency,
    input.paymentStatus,
    input.stripeSession,
    input.createdAt,
    "",
  ];

  await appendRow(SHEET_NAME, RENEWAL_HEADERS, row);
}

export async function markRenewalPaid(renewalId: string, sessionId: string, paidAt: string): Promise<void> {
  const rows = await readRange(`'${SHEET_NAME}'!A1:N1000`);
  const dataRows = rows.slice(1);

  const idx = dataRows.findIndex((r) => r[0] === renewalId);
  if (idx === -1) {
    return;
  }
  const rowNumber = idx + 2;

  const existing = dataRows[idx];
  // K=payment_status, L=stripe_session, M=created_at, N=paid_at.
  // stripe_session is empty at row creation (the Checkout Session is created
  // AFTER appendRenewal), so backfill it here from the webhook.
  await updateRange(`'${SHEET_NAME}'!K${rowNumber}:N${rowNumber}`, [[
    "paid",
    sessionId || (existing[11] ?? ""),
    existing[12] ?? "",
    paidAt,
  ]]);
}

export async function updateRenewalPdEntries(renewalId: string, entries: PdEntry[]): Promise<void> {
  const rows = await readRange(`'${SHEET_NAME}'!A1:H1000`);
  const dataRows = rows.slice(1);

  const idx = dataRows.findIndex((r) => r[0] === renewalId);
  if (idx === -1) return;
  const rowNumber = idx + 2;

  await updateRange(`'${SHEET_NAME}'!H${rowNumber}`, [[JSON.stringify(entries)]]);
}

/**
 * Returns the public Google Sheets URL for the renewals spreadsheet.
 * Returns undefined if GOOGLE_SHEETS_SPREADSHEET_ID is not set (admin email
 * falls back to no-link line).
 */
export function getRenewalsSheetUrl(): string | undefined {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!id) return undefined;
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

export async function getRenewalById(renewalId: string): Promise<RenewalRow | null> {
  const rows = await readRange(`'${SHEET_NAME}'!A1:N1000`);
  const dataRows = rows.slice(1);

  // Match by renewal_id (col A). stripe_session (col L) is empty until the
  // webhook backfills it, so it cannot be the lookup key.
  const match = dataRows.find((r) => r[0] === renewalId);
  if (!match) return null;

  const pdRaw = match[7] ?? "[]";
  const pdEntries: PdEntry[] = (() => {
    try { return JSON.parse(pdRaw); } catch { return []; }
  })();

  // Plan finding m3 + phase K: tier value is data-driven from TIERS. Legacy
  // values from before the rename (pm=old professional, am=old associate) map
  // to the renamed storageValues (adv, basic). Any other unknown value falls
  // back to the first tier in TIERS to keep callers safe.
  const validStorageValues = new Set(listTiers().map((t) => t.storageValue));
  const legacyTierMap: Record<string, string> = { pm: "adv", am: "basic" };
  const rawTier = String(match[1] ?? "");
  const tier: string = legacyTierMap[rawTier] ?? (validStorageValues.has(rawTier) ? rawTier : (listTiers()[0]?.storageValue ?? "adv"));

  return {
    renewalId: match[0] ?? "",
    tier,
    renewalYear: Number(match[2] ?? 0),
    firstName: match[3] ?? "",
    lastName: match[4] ?? "",
    email: match[5] ?? "",
    phone: match[6] ?? "",
    pdEntries,
    amountPaidCents: Number(match[8] ?? 0),
    currency: match[9] ?? CURRENCY,
    paymentStatus: (match[10] === "paid" ? "paid" : "pending"),
    stripeSession: match[11] ?? "",
    createdAt: match[12] ?? "",
    paidAt: match[13] ?? "",
  };
}
