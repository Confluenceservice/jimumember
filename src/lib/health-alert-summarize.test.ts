import { describe, expect, it } from "vitest";
import { summarizeResult } from "../../.run/health-alert-worker/summarize.mjs";

const base = { name: "prod", ok: true, httpStatus: 200, latencyMs: 12, error: null };

describe("health alert summarizeResult", () => {
  it("reads the new payment shape", () => {
    const out = summarizeResult({
      ...base,
      body: { status: "ok", payment: { provider: "airwallex", status: "connected" }, email: "connected" },
    });
    expect(out).toMatchObject({
      name: "prod", ok: true, httpStatus: 200, latencyMs: 12,
      provider: "airwallex", payment: "connected", email: "connected", status: "ok", error: null,
    });
  });

  it("falls back to the old stripe key from an app that predates the payment key", () => {
    const out = summarizeResult({ ...base, body: { status: "ok", stripe: "connected", email: "connected" } });
    expect(out).toMatchObject({ provider: "stripe", payment: "connected" });
  });

  it("prefers payment when both keys are present", () => {
    const out = summarizeResult({
      ...base,
      body: { status: "degraded", payment: { provider: "stripe", status: "disconnected" }, stripe: "connected" },
    });
    expect(out).toMatchObject({ provider: "stripe", payment: "disconnected", status: "degraded" });
  });

  it("does not throw when the body is null (fetch failed)", () => {
    const out = summarizeResult({ ...base, ok: false, httpStatus: 0, body: null, error: "warmup_timeout: x" });
    expect(out.payment).toBeUndefined();
    expect(out.provider).toBeUndefined();
    expect(out).toMatchObject({ ok: false, httpStatus: 0, error: "warmup_timeout: x" });
  });
});
