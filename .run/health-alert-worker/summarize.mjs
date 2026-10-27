// Pure helper (kept out of worker.mjs so it can be unit-tested and so the
// worker entry file only exports its handler).
//
// /api/health reports the payment subsystem as `payment: { provider, status }`.
// Apps that predate that key only send the Stripe-era `stripe: "<status>"`
// string; fall back to it so a new worker works against an old app.
export function summarizeResult(r) {
  const body = r.body;
  return {
    name: r.name,
    ok: r.ok,
    httpStatus: r.httpStatus,
    latencyMs: r.latencyMs,
    provider: body?.payment?.provider ?? (body?.stripe !== undefined ? "stripe" : undefined),
    payment: body?.payment?.status ?? body?.stripe,
    email: body?.email,
    status: body?.status,
    error: r.error,
  };
}
