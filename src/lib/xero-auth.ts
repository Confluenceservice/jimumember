import { logger } from "./logger";
import { readRefreshToken, writeRefreshToken } from "./xero-token-store";

/**
 * Xero OAuth2 access-token acquisition, in two interchangeable modes
 * (`XERO_AUTH_MODE`):
 *
 *   custom   — Custom Connection / client_credentials. Machine-to-machine,
 *              single org, no user consent, no refresh token, no 60-day
 *              idle expiry. The correct shape for unattended server work.
 *   authcode — Standard authorization-code flow. Free, but the refresh
 *              token ROTATES on every use, so it must be persisted before
 *              the paired access token is used (see xero-token-store).
 *
 * Only one mode is live per process, so the token cache below is shared.
 *
 * Concurrency: parallel webhooks must not each start a refresh. In
 * authcode mode a double refresh is not merely wasteful — the second
 * request presents a refresh token the first has already rotated away,
 * which Xero rejects and which can brick the connection. A single
 * in-flight promise serialises them. It clears itself in `finally` so a
 * REJECTED refresh is never cached: the next caller retries instead of
 * awaiting a settled rejection forever.
 */

const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";

/** Custom Connections cannot request offline_access — there is no refresh token. */
const CUSTOM_SCOPES = "accounting.transactions accounting.contacts accounting.settings";
/** offline_access is what makes Xero return a refresh_token at all. */
const AUTHCODE_SCOPES = `offline_access ${CUSTOM_SCOPES}`;

/** Refresh this many ms before the token actually expires. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export type XeroAuthMode = "custom" | "authcode";

export interface XeroAccessToken {
  accessToken: string;
  tenantId: string;
}

export interface XeroAuth {
  getAccessToken(): Promise<XeroAccessToken>;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;
let cachedTenantId: string | null = null;
let inFlight: Promise<XeroAccessToken> | null = null;

/** Test-only. Production callers rely on process-lifetime caching. */
export function _resetXeroAuthCacheForTesting(): void {
  cachedToken = null;
  cachedTenantId = null;
  inFlight = null;
}

/**
 * Drops the cached access token so the next getAccessToken() fetches a
 * fresh one. Called by xero-client when Xero answers 401 — the token was
 * revoked or expired early despite our margin.
 *
 * The tenant id is deliberately kept: it is a property of the connection,
 * not the token, and re-resolving it would cost an extra /connections call
 * on every 401.
 */
export function invalidateAccessToken(): void {
  cachedToken = null;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_CONFIG: ${name}`);
  return value;
}

export function getAuthMode(): XeroAuthMode {
  const mode = process.env.XERO_AUTH_MODE?.trim().toLowerCase();
  if (mode === "custom" || mode === "authcode") return mode;
  throw new Error(`MISSING_CONFIG: XERO_AUTH_MODE must be "custom" or "authcode", got "${mode ?? ""}"`);
}

function basicAuthHeader(): string {
  const id = requireEnv("XERO_CLIENT_ID");
  const secret = requireEnv("XERO_CLIENT_SECRET");
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

/**
 * POSTs to the Xero token endpoint. Never logs the body — it carries both
 * the access token and (in authcode mode) the rotated refresh token.
 */
async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    // Xero returns {"error":"invalid_grant"} for a dead/rotated refresh
    // token. The error CODE is safe to surface; the body is not.
    const text = await res.text().catch(() => "");
    const code = text.slice(0, 200);
    throw new Error(`XERO_TOKEN_FAILED: ${res.status} ${code}`);
  }

  return (await res.json()) as TokenResponse;
}

/**
 * Confirms the token can actually see the org we expect to write to.
 *
 * This is the second half of the environment guard (the first being
 * assertEnvironmentSafe's livemode check in xero-sync): even a correctly
 * configured live-mode webhook must not write into the wrong Xero org.
 *
 * NOTE (unverified against a live org): each element of the /connections
 * response is assumed to expose `tenantId` — distinct from the connection's
 * own `id`. Reading the wrong field yields a guard that silently never
 * matches. Confirm during staging validation (runbook step 5).
 */
async function resolveTenantId(accessToken: string): Promise<string> {
  const expected = requireEnv("XERO_TENANT_ID");
  if (cachedTenantId) return cachedTenantId;

  const res = await fetch(CONNECTIONS_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`XERO_CONNECTIONS_FAILED: ${res.status}`);
  }

  const connections = (await res.json()) as Array<{ tenantId?: string }>;
  const available = connections.map((c) => c.tenantId).filter(Boolean) as string[];

  if (!available.includes(expected)) {
    // Tenant ids are opaque UUIDs, safe to log — and without them this
    // failure is undiagnosable.
    logger.error("xero_auth.tenant_mismatch", { expected, available });
    throw new Error(
      `XERO_TENANT_MISMATCH: token does not grant access to ${expected}`,
    );
  }

  cachedTenantId = expected;
  return expected;
}

async function refreshCustomConnection(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: CUSTOM_SCOPES,
  });
  const token = await postToken(body);
  cachedToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS,
  };
  return token.access_token;
}

async function refreshAuthCode(): Promise<string> {
  const stored = await readRefreshToken();
  if (!stored) {
    throw new Error(
      "XERO_NOT_CONNECTED: no refresh token stored — run /api/xero/oauth/start",
    );
  }

  const token = await postToken(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: stored }),
  );

  // ORDER MATTERS. Xero invalidated `stored` the moment it answered, so the
  // token in this response is the only live one. Persist it BEFORE returning
  // — writeRefreshToken throws on failure, which correctly fails this
  // refresh rather than handing back an access token whose successor we
  // have already lost.
  if (token.refresh_token) {
    await writeRefreshToken(token.refresh_token);
  } else {
    logger.warn("xero_auth.refresh_response_missing_refresh_token");
  }

  cachedToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS,
  };
  return token.access_token;
}

async function acquire(mode: XeroAuthMode): Promise<XeroAccessToken> {
  const accessToken =
    mode === "custom" ? await refreshCustomConnection() : await refreshAuthCode();
  const tenantId = await resolveTenantId(accessToken);
  logger.info("xero_auth.token_acquired", { mode });
  return { accessToken, tenantId };
}

async function getAccessTokenForMode(mode: XeroAuthMode): Promise<XeroAccessToken> {
  if (cachedToken && cachedTenantId && Date.now() < cachedToken.expiresAt) {
    return { accessToken: cachedToken.accessToken, tenantId: cachedTenantId };
  }
  if (!inFlight) {
    inFlight = acquire(mode).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Selects the adapter from XERO_AUTH_MODE. Both share the token cache. */
export function getXeroAuth(): XeroAuth {
  const mode = getAuthMode();
  return { getAccessToken: () => getAccessTokenForMode(mode) };
}

// ---------------------------------------------------------------------------
// Authorization-code consent flow. Only reachable when XERO_AUTH_MODE=authcode.
// ---------------------------------------------------------------------------

/** The Xero consent URL a human is redirected to by /api/xero/oauth/start. */
export function buildConsentUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: requireEnv("XERO_CLIENT_ID"),
    redirect_uri: requireEnv("XERO_REDIRECT_URI"),
    scope: AUTHCODE_SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * One-time code -> token exchange for /api/xero/oauth/callback.
 *
 * Ordering is the MIRROR of refreshAuthCode, deliberately. There is no prior
 * refresh token to lose here, so the tenant is verified FIRST and nothing is
 * persisted if the consent granted access to the wrong org. During a
 * rotation the opposite holds: persist first, because the old token is
 * already dead.
 */
export async function exchangeAuthorizationCode(code: string): Promise<string> {
  const token = await postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: requireEnv("XERO_REDIRECT_URI"),
    }),
  );

  const tenantId = await resolveTenantId(token.access_token);

  if (!token.refresh_token) {
    throw new Error(
      "XERO_NO_REFRESH_TOKEN: consent did not return one — is offline_access in the app's scopes?",
    );
  }
  await writeRefreshToken(token.refresh_token);

  cachedToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS,
  };
  logger.info("xero_auth.consent_completed", { tenantId });
  return tenantId;
}
