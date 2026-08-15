import type { APIRoute } from "astro";
import { exchangeAuthorizationCode, getAuthMode } from "../../../../lib/xero-auth";
import { logger } from "../../../../lib/logger";
import { clearOAuthState, readOAuthState } from "../../../../lib/xero-token-store";

/**
 * Xero consent callback. Only reachable when XERO_AUTH_MODE=authcode.
 *
 * There is no shared secret here — Xero redirects the operator's browser to
 * this URL, so the only thing that can authenticate the request is the
 * `state` nonce this app itself minted in /api/xero/oauth/start. It is
 * compared exactly and then consumed, so a replayed callback fails.
 *
 * Nothing about the token, the code, or the nonce is echoed into the
 * response body or the logs.
 */

function page(title: string, detail: string, status: number): Response {
  const escape = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title>` +
      `<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">` +
      `<h1>${escape(title)}</h1><p>${escape(detail)}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export const GET: APIRoute = async ({ request }) => {
  let mode: string;
  try {
    mode = getAuthMode();
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (mode !== "authcode") return new Response("Not found", { status: 404 });

  const url = new URL(request.url);

  // Xero reports a declined/failed consent via ?error=, with no code.
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    logger.warn("xero_oauth_callback.provider_error", { error: oauthError });
    return page("Consent failed", `Xero reported: ${oauthError}`, 400);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return page("Consent failed", "Missing code or state in the callback.", 400);
  }

  const expectedState = await readOAuthState();
  if (!expectedState || expectedState !== state) {
    // The nonce lives in a single shared row, so two overlapping consent
    // attempts clobber each other and the earlier callback lands here.
    // Say so explicitly — a bare "invalid state" sends the operator hunting
    // for a bug that isn't there.
    logger.warn("xero_oauth_callback.state_mismatch", { hadStoredState: !!expectedState });
    return page(
      "Consent failed",
      "The state nonce did not match. This callback is stale, replayed, or a second " +
        "consent attempt was started before this one finished. Start again from " +
        "/api/xero/oauth/start.",
      400,
    );
  }

  try {
    const tenantId = await exchangeAuthorizationCode(code);
    await clearOAuthState();
    logger.info("xero_oauth_callback.connected", { tenantId });
    return page(
      "Xero connected",
      "The refresh token has been stored. You can close this tab. " +
        "Rotate XERO_CONSENT_SECRET now — it was passed as a query parameter and is in the access logs.",
      200,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("xero_oauth_callback.exchange_failed", { error: msg });
    // The nonce is deliberately NOT cleared here: a transient Sheets or
    // network failure should leave the operator able to retry the same
    // consent rather than having to restart the whole flow.
    return page("Consent failed", msg, 400);
  }
};
