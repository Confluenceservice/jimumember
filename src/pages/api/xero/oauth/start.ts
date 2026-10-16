import type { APIRoute } from "astro";
import { buildConsentUrl, getAuthMode } from "../../../../lib/xero-auth";
import { logger } from "../../../../lib/logger";
import { safeSecretCompare } from "../../../../lib/secret-compare";
import { writeOAuthState } from "../../../../lib/xero-token-store";

/**
 * One-time Xero consent initiator. Only reachable when
 * XERO_AUTH_MODE=authcode; Custom Connections need no consent at all.
 *
 * GATE: `?secret=` matched in constant time against XERO_CONSENT_SECRET.
 *
 * Why a query parameter and not the X-Sync-Secret header used by the
 * sweeper: this is a redirect a human follows in a browser, and a browser
 * cannot attach a custom header to a link click. The trade-off is that the
 * secret lands in Fly access logs, which is why it is a SEPARATE secret
 * from the sweeper's — a leaked log line must not also hand over the
 * sweeper endpoint. Rotate XERO_CONSENT_SECRET after connecting.
 *
 * An unset XERO_CONSENT_SECRET denies everything (safeSecretCompare fails
 * closed) rather than leaving an open consent initiator on a public app.
 */
export const GET: APIRoute = async ({ request }) => {
  let mode: string;
  try {
    mode = getAuthMode();
  } catch {
    return new Response("Not found", { status: 404 });
  }
  // 404, not 501: don't advertise a surface that isn't in use.
  if (mode !== "authcode") return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  if (!safeSecretCompare(url.searchParams.get("secret"), process.env.XERO_CONSENT_SECRET)) {
    logger.warn("xero_oauth_start.rejected");
    return new Response("Unauthorized", { status: 401 });
  }

  const state = crypto.randomUUID();
  try {
    await writeOAuthState(state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("xero_oauth_start.state_write_failed", { error: msg });
    // Proceeding would guarantee a failed callback — the nonce it echoes
    // back could never be matched.
    return new Response("Could not start consent: state could not be stored.", {
      status: 500,
    });
  }

  logger.info("xero_oauth_start.redirecting");
  return new Response(null, {
    status: 302,
    headers: { Location: buildConsentUrl(state), "Cache-Control": "no-store" },
  });
};
