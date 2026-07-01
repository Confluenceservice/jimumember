import { google } from "googleapis";
import { getServiceAccountJwtAuth } from "./google-auth";
import { logger } from "./logger";

/**
 * Shared Google Sheets plumbing used by every sheet-backed lib
 * (renewal-sheet.ts, feedback-sheet.ts, google-sheets.ts, upload-sheet.ts).
 * Covers: authenticated client construction (cached + retried), tab
 * find-or-create with self-healing headers, and generic row read/write.
 * Callers with bespoke per-cell update logic (e.g. upload-sheet.ts's
 * column-letter lookups) use the lower-level readRange/updateRange/
 * batchUpdateRanges primitives directly.
 */

let sheetsClientPromise: Promise<ReturnType<typeof google.sheets>> | null = null;

// E2E offline stub. When E2E_STUB=1 the Sheets client is replaced with an
// in-memory no-op that satisfies every call any sheet-backed lib makes
// WITHOUT touching Google: spreadsheets.get reports no tabs (so
// ensureSheetWithHeaders always takes the "create" branch, whose
// batchUpdate/update calls are themselves no-ops here), and values.get
// returns no rows (so row-lookup functions resolve to "not found"). Reads/
// writes are accepted and discarded. This is the only way to drive
// POST /api/advanced/apply end-to-end in a Playwright smoke run, since these
// are server-side googleapis calls a browser cannot intercept. No-op in
// every non-E2E environment (the env var is unset). See e2e/apply.spec.ts.
function makeStubSheetsClient(): ReturnType<typeof google.sheets> {
  const ok = async () => ({ data: {} });
  const stub = {
    spreadsheets: {
      get: async () => ({ data: { sheets: [] } }),
      batchUpdate: ok,
      values: {
        get: async () => ({ data: { values: [] } }),
        append: ok,
        update: ok,
        batchUpdate: ok,
      },
    },
  };
  return stub as unknown as ReturnType<typeof google.sheets>;
}

export async function getSheetsClient(): Promise<ReturnType<typeof google.sheets>> {
  if (process.env.E2E_STUB === "1") return makeStubSheetsClient();

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

export function _resetSheetsClientCacheForTesting(): void {
  sheetsClientPromise = null;
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

export async function withTransientRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
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
      logger.warn("sheets_helper_transient_retry", {
        label, attempt, maxAttempts: MAX_ATTEMPTS, delayMs,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Unreachable: last iteration either returns or throws.
  throw lastErr;
}

export function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!id) throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  return id;
}

/** 1-indexed column number -> spreadsheet column letters (1=A, 26=Z, 27=AA, 47=AU, ...). */
export function columnLetter(n: number): string {
  let s = "";
  let rem = n;
  while (rem > 0) {
    const mod = (rem - 1) % 26;
    s = String.fromCharCode(65 + mod) + s;
    rem = Math.floor((rem - 1) / 26);
  }
  return s;
}

/**
 * Finds (or creates) a tab named `sheetName` and makes sure its header row
 * matches `headers`. Self-heals rather than unconditionally overwriting: if
 * the tab already exists and row 1 already starts with the expected first
 * header, nothing is touched (so admin edits to data rows are never
 * reverted). If row 1 is missing/wrong (e.g. an earlier creation run whose
 * header write failed), a row is inserted at the top and headers are
 * written there.
 */
export async function ensureSheetWithHeaders(sheetName: string, headers: readonly string[]): Promise<void> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();
  const lastCol = columnLetter(headers.length);

  const meta = await withTransientRetry(`ensure_sheet.get:${sheetName}`, () =>
    sheets.spreadsheets.get({ spreadsheetId }),
  );
  const existing = (meta.data.sheets ?? []).find((s) => s.properties?.title === sheetName);

  if (!existing) {
    await withTransientRetry(`ensure_sheet.create:${sheetName}`, () =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      }),
    );
    await withTransientRetry(`ensure_sheet.headers:${sheetName}`, () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A1:${lastCol}1`,
        valueInputOption: "RAW",
        requestBody: { values: [Array.from(headers)] },
      }),
    );
    return;
  }

  const firstRowRes = await withTransientRetry(`ensure_sheet.header_check:${sheetName}`, () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A1:A1`,
    }),
  );
  const a1 = firstRowRes.data.values?.[0]?.[0];
  if (a1 === headers[0]) return; // header already present

  const sheetId = existing.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) return;

  await withTransientRetry(`ensure_sheet.insert_header_row:${sheetName}`, () =>
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
  await withTransientRetry(`ensure_sheet.backfill_headers:${sheetName}`, () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1:${lastCol}1`,
      valueInputOption: "RAW",
      requestBody: { values: [Array.from(headers)] },
    }),
  );
}

/** Ensures the tab + headers exist, then appends one row to it. */
export async function appendRow(
  sheetName: string,
  headers: readonly string[],
  row: Array<string | number>,
): Promise<void> {
  await ensureSheetWithHeaders(sheetName, headers);
  const lastCol = columnLetter(headers.length);
  await appendToRange(`'${sheetName}'!A1:${lastCol}1`, row);
}

/** Raw append with no tab management — for tabs assumed to already exist. */
export async function appendToRange(range: string, row: Array<string | number>): Promise<void> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();
  await withTransientRetry(`append_to_range:${range}`, () =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    }),
  );
}

/** Raw read of an arbitrary range, including any header row. */
export async function readRange(range: string): Promise<string[][]> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();
  const res = await withTransientRetry(`read_range:${range}`, () =>
    sheets.spreadsheets.values.get({ spreadsheetId, range }),
  );
  return (res.data.values ?? []) as string[][];
}

/** Reads a tab's full column range and strips the header row. */
export async function readDataRows(sheetName: string, headers: readonly string[]): Promise<string[][]> {
  const lastCol = columnLetter(headers.length);
  const rows = await readRange(`'${sheetName}'!A:${lastCol}`);
  return rows.slice(1);
}

/** Raw single-range update — for targeted cell/row writes by callers that already know the range. */
export async function updateRange(range: string, values: unknown[][]): Promise<void> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();
  await withTransientRetry(`update_range:${range}`, () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values },
    }),
  );
}

/** Raw multi-range batch update. */
export async function batchUpdateRanges(data: Array<{ range: string; values: unknown[][] }>): Promise<void> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();
  await withTransientRetry("batch_update_ranges", () =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data },
    }),
  );
}
