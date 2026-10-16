import type { APIRoute } from "astro";
import { logger } from "../../../lib/logger";
import { safeSecretCompare } from "../../../lib/secret-compare";
import { isXeroEnabled, sweepPending } from "../../../lib/xero-sync";

/**
 * Re-drives pending rows in the "Xero Sync" tab.
 *
 * This is the retry loop the plan's F2 finding demands. The webhook pushes
 * to Xero inline and gives up after one attempt, because it is running
 * inside Stripe's request timeout and fly.toml sets
 * min_machines_running = 0 — a background promise scheduled after the
 * response may never run. Anything that failed there stays `pending` and is
 * picked up here instead.
 *
 * Driven by a time-based Apps Script trigger (apps-script/xero-sweeper).
 * The inbound request also wakes the stopped Fly machine, which is why a
 * plain scheduled GET is enough infrastructure.
 *
 * GATE: X-Sync-Secret, constant-time compared against XERO_SYNC_SECRET. An
 * unset secret denies everything — safeSecretCompare fails closed.
 *
 * /api/xero/ is exempt from the middleware rate limiter (see
 * src/middleware.ts): 30 requests per IP per 15 minutes would throttle this
 * trigger, and callers without a forwarded-for header all share one bucket.
 */

/** Bounded so one sweep cannot run long enough to overlap the next trigger. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export const GET: APIRoute = async ({ request }) => {
  if (!safeSecretCompare(request.headers.get("x-sync-secret"), process.env.XERO_SYNC_SECRET)) {
    logger.warn("xero_sync_pending.rejected");
    return new Response("Unauthorized", { status: 401 });
  }

  // Reported rather than 404'd: the trigger runs on a schedule and its
  // operator needs to see that the kill switch is what stopped the sweep,
  // not a broken endpoint.
  if (!isXeroEnabled()) {
    return Response.json({
      enabled: false,
      swept: 0,
      done: 0,
      stillPending: 0,
      permanentFailures: 0,
    });
  }

  const limit = parseLimit(new URL(request.url).searchParams.get("limit"));

  try {
    const result = await sweepPending(limit);
    return Response.json({ enabled: true, ...result });
  } catch (err) {
    // sweepPending handles per-row failures itself, so reaching here means
    // something structural (Sheets unreachable, config missing). Surface it
    // as a 500 so the trigger's execution log shows a failure.
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("xero_sync_pending.sweep_failed", { error: msg });
    return Response.json({ error: msg }, { status: 500 });
  }
};
