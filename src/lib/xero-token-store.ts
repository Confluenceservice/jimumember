import {
  _resetSheetsClientCacheForTesting,
  ensureSheetWithHeaders,
  readRange,
  updateRange,
} from "./google-sheets-helpers";
import { logger } from "./logger";

/**
 * Persisted Xero OAuth state for `XERO_AUTH_MODE=authcode`. Custom-connection
 * mode (client_credentials) never touches this module — it has no refresh
 * token at all.
 *
 * Xero's authorization-code flow ROTATES the refresh token on every use and
 * expires it after ~60 days idle. On Fly with `min_machines_running = 0` the
 * process dies constantly, so the token cannot live in memory: losing a
 * rotated token bricks the connection until a human re-consents via
 * /api/xero/oauth/start.
 *
 * Schema — a SINGLE data row (row 2), overwritten in place, never appended:
 *   A refresh_token — the current rotating token
 *   B obtained_at   — ISO, stamped on the first write, preserved after
 *   C rotated_at    — ISO, updated on every write
 *   D oauth_state   — single-use consent nonce; "" when not mid-flow
 *
 * Failure contract differs deliberately per direction:
 *   - READS fail-CLOSED to `null`. A Sheets outage then surfaces as an auth
 *     failure, which leaves the Xero Sync row `pending` for the sweeper.
 *     That is recoverable.
 *   - `writeRefreshToken` THROWS. This is the one write in the codebase that
 *     must NOT be swallowed: a silently-dropped rotation means the token Xero
 *     just invalidated is the only one we still hold. The caller must persist
 *     successfully BEFORE using the access token that came with it.
 */

const SHEET_NAME = "Xero Auth";
const HEADERS = ["refresh_token", "obtained_at", "rotated_at", "oauth_state"] as const;
const ROW_RANGE = `'${SHEET_NAME}'!A2:D2`;

export { _resetSheetsClientCacheForTesting };

type StoredRow = {
  refreshToken: string;
  obtainedAt: string;
  rotatedAt: string;
  oauthState: string;
};

const EMPTY_ROW: StoredRow = {
  refreshToken: "",
  obtainedAt: "",
  rotatedAt: "",
  oauthState: "",
};

/**
 * Reads row 2. Returns EMPTY_ROW on any failure so callers can still decide
 * to write — see writeRefreshToken, where losing the read must not block the
 * rotation itself.
 */
async function readRow(): Promise<StoredRow> {
  try {
    await ensureSheetWithHeaders(SHEET_NAME, HEADERS);
    const rows = await readRange(ROW_RANGE);
    const row = rows[0] ?? [];
    return {
      refreshToken: row[0] ?? "",
      obtainedAt: row[1] ?? "",
      rotatedAt: row[2] ?? "",
      oauthState: row[3] ?? "",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("xero_token_store.read_failed", { error: msg });
    return { ...EMPTY_ROW };
  }
}

/** Overwrites row 2 in place. Throws — callers decide whether to swallow. */
async function writeRow(row: StoredRow): Promise<void> {
  await ensureSheetWithHeaders(SHEET_NAME, HEADERS);
  await updateRange(ROW_RANGE, [
    [row.refreshToken, row.obtainedAt, row.rotatedAt, row.oauthState],
  ]);
}

/** The current refresh token, or null if none is stored / the read failed. */
export async function readRefreshToken(): Promise<string | null> {
  const row = await readRow();
  return row.refreshToken || null;
}

/**
 * Persists a rotated refresh token. THROWS on failure by design — the caller
 * must not proceed to use the paired access token if this did not land.
 *
 * `obtained_at` is stamped only on the first write so the 60-day idle window
 * stays measurable; `rotated_at` moves every time. The oauth_state column is
 * carried through untouched.
 */
export async function writeRefreshToken(token: string): Promise<void> {
  if (!token) {
    // Guard against blanking a good token with a malformed token response.
    throw new Error("xero-token-store: refusing to write an empty refresh_token");
  }
  const existing = await readRow();
  const now = new Date().toISOString();
  await writeRow({
    refreshToken: token,
    obtainedAt: existing.obtainedAt || now,
    rotatedAt: now,
    oauthState: existing.oauthState,
  });
  // Never log the token itself — only that a rotation landed.
  logger.info("xero_token_store.refresh_token_written", { firstWrite: !existing.obtainedAt });
}

/** Stores the single-use consent nonce, preserving the token columns. */
export async function writeOAuthState(nonce: string): Promise<void> {
  const existing = await readRow();
  await writeRow({ ...existing, oauthState: nonce });
}

/** The pending consent nonce, or null if none is stored / the read failed. */
export async function readOAuthState(): Promise<string | null> {
  const row = await readRow();
  return row.oauthState || null;
}

/**
 * Consumes the nonce after a callback. Swallows failures: the nonce is
 * checked for equality on the next callback regardless, and a failed clear
 * must never turn a successful consent into an error.
 */
export async function clearOAuthState(): Promise<void> {
  try {
    const existing = await readRow();
    await writeRow({ ...existing, oauthState: "" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("xero_token_store.clear_state_failed", { error: msg });
  }
}
