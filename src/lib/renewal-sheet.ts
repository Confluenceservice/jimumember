import { google } from "googleapis";
import { getServiceAccountJwtAuth } from "./google-auth";
import { logger } from "./logger";

export interface PdEntry {
  dateCompleted: string;
  activity: string;
  totalHours: number;
  provider: string;
}

export interface RenewalInput {
  renewalId: string;
  tier: "pm" | "am";
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
  tier: "pm" | "am";
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

let sheetsClientPromise: Promise<ReturnType<typeof google.sheets>> | null = null;

async function getSheetsClient() {
  // Cache the auth-warmed client across all calls in this process. The OAuth
  // token (good for ~1h) is fetched once and reused. Pre-warming in this layer
  // lets the transient-retry wrapper catch "Premature close" / "ECONNRESET"
  // drops in gaxios before any Sheets call would otherwise throw an opaque
  // auth error from the JWT client internals.
  if (!sheetsClientPromise) {
    sheetsClientPromise = (async () => {
      const auth = getServiceAccountJwtAuth(["https://www.googleapis.com/auth/spreadsheets"]);
      await withTransientRetry("oauth_token_refresh", async () => {
        await auth.authorize();
      });
      return google.sheets({ version: "v4", auth });
    })();
  }
  return sheetsClientPromise;
}

// Google OAuth token endpoint drops connections intermittently with
// "Premature close" / "ECONNRESET" / "EAI_AGAIN". These are transient and
// retrying the underlying Sheets call recovers cleanly. Match on the common
// shapes, not just the message — error chain varies across node-fetch versions.
function isTransientNetworkError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code;
  if (msg.includes("Premature close")) return true;
  if (msg.includes("ECONNRESET")) return true;
  if (msg.includes("ETIMEDOUT")) return true;
  if (msg.includes("EAI_AGAIN")) return true;
  if (msg.includes("socket hang up")) return true;
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EAI_AGAIN") return true;
  return false;
}

async function withTransientRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  // Google OAuth endpoint occasionally bursts of failures lasting ~2-5s.
  // 5 attempts with 500/1000/2000/4000ms backoff (+jitter) covers those.
  const MAX_ATTEMPTS = 5;
  const BASE_DELAYS_MS = [500, 1000, 2000, 4000]; // index = attempt-2 (so attempt 2 waits 500ms, etc.)
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientNetworkError(err) || attempt === MAX_ATTEMPTS) throw err;
      const base = BASE_DELAYS_MS[attempt - 2] ?? 4000;
      // ±20% jitter prevents thundering herd when many requests retry in lockstep.
      const jitter = Math.floor(base * 0.2 * (Math.random() * 2 - 1));
      const delayMs = base + jitter;
      logger.warn("renewal_sheet_transient_retry", {
        label, attempt, maxAttempts: MAX_ATTEMPTS, delayMs,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Unreachable: last iteration either returns or throws.
  throw lastErr;
}

async function ensureRenewalsSheet(): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("MISSING_CONFIG: GOOGLE_SHEETS_SPREADSHEET_ID");
  const sheets = await getSheetsClient();

  const meta = await withTransientRetry("ensure_sheet.get", () =>
    sheets.spreadsheets.get({ spreadsheetId }),
  );
  const existing = (meta.data.sheets ?? []).find((s) => s.properties?.title === SHEET_NAME);

  if (!existing) {
    await withTransientRetry("ensure_sheet.batchUpdate", () =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
        },
      }),
    );
    await withTransientRetry("ensure_sheet.headers", () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_NAME}'!A1:N1`,
        valueInputOption: "RAW",
        requestBody: { values: [RENEWAL_HEADERS as unknown as string[]] },
      }),
    );
    return;
  }

  // Self-heal: the sheet exists but may be missing its header row (e.g. created
  // by an earlier run where the header write failed). If row 1 isn't the header,
  // insert a fresh row at the top and write headers — without overwriting any
  // existing data row that currently sits at row 1.
  const firstRowRes = await withTransientRetry("ensure_sheet.header_check", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1:A1`,
    }),
  );
  const a1 = firstRowRes.data.values?.[0]?.[0];
  if (a1 === RENEWAL_HEADERS[0]) return; // header already present

  const sheetId = existing.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) return;

  await withTransientRetry("ensure_sheet.insert_header_row", () =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          insertDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
            inheritFromBefore: false,
          },
        }],
      },
    }),
  );
  await withTransientRetry("ensure_sheet.backfill_headers", () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1:N1`,
      valueInputOption: "RAW",
      requestBody: { values: [RENEWAL_HEADERS as unknown as string[]] },
    }),
  );
}

export function _resetSheetsClientCacheForTesting(): void {
  sheetsClientPromise = null;
}

export async function appendRenewal(input: RenewalInput): Promise<void> {
  await ensureRenewalsSheet();

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("MISSING_CONFIG: GOOGLE_SHEETS_SPREADSHEET_ID");
  const sheets = await getSheetsClient();

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

  await withTransientRetry("append_renewal", () =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1:N1`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    }),
  );
}

export async function markRenewalPaid(renewalId: string, sessionId: string, paidAt: string): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("MISSING_CONFIG: GOOGLE_SHEETS_SPREADSHEET_ID");
  const sheets = await getSheetsClient();

  const res = await withTransientRetry("mark_paid.get", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1:N1000`,
    }),
  );
  const rows = res.data.values ?? [];
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
  await withTransientRetry("mark_paid.update", () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!K${rowNumber}:N${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          "paid",
          sessionId || (existing[11] ?? ""),
          existing[12] ?? "",
          paidAt,
        ]],
      },
    }),
  );
}

export async function updateRenewalPdEntries(renewalId: string, entries: PdEntry[]): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("MISSING_CONFIG: GOOGLE_SHEETS_SPREADSHEET_ID");
  const sheets = await getSheetsClient();

  const res = await withTransientRetry("update_pd.get", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1:H1000`,
    }),
  );
  const rows = res.data.values ?? [];
  const dataRows = rows.slice(1);

  const idx = dataRows.findIndex((r) => r[0] === renewalId);
  if (idx === -1) return;
  const rowNumber = idx + 2;

  await withTransientRetry("update_pd.update", () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!H${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [[JSON.stringify(entries)]] },
    }),
  );
}

export async function getRenewalById(renewalId: string): Promise<RenewalRow | null> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("MISSING_CONFIG: GOOGLE_SHEETS_SPREADSHEET_ID");
  const sheets = await getSheetsClient();

  const res = await withTransientRetry("get_by_id", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1:N1000`,
    }),
  );
  const rows = res.data.values ?? [];
  const dataRows = rows.slice(1);

  // Match by renewal_id (col A). stripe_session (col L) is empty until the
  // webhook backfills it, so it cannot be the lookup key.
  const match = dataRows.find((r) => r[0] === renewalId);
  if (!match) return null;

  const pdRaw = match[7] ?? "[]";
  const pdEntries: PdEntry[] = (() => {
    try { return JSON.parse(pdRaw); } catch { return []; }
  })();

  return {
    renewalId: match[0] ?? "",
    tier: (match[1] === "am" ? "am" : "pm"),
    renewalYear: Number(match[2] ?? 0),
    firstName: match[3] ?? "",
    lastName: match[4] ?? "",
    email: match[5] ?? "",
    phone: match[6] ?? "",
    pdEntries,
    amountPaidCents: Number(match[8] ?? 0),
    currency: match[9] ?? "nzd",
    paymentStatus: (match[10] === "paid" ? "paid" : "pending"),
    stripeSession: match[11] ?? "",
    createdAt: match[12] ?? "",
    paidAt: match[13] ?? "",
  };
}
