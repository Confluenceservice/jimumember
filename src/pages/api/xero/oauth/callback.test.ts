import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockReadOAuthState, mockClearOAuthState, mockExchange } = vi.hoisted(() => ({
  mockReadOAuthState: vi.fn(),
  mockClearOAuthState: vi.fn(),
  mockExchange: vi.fn(),
}));

vi.mock("../../../../lib/xero-token-store", () => ({
  readOAuthState: mockReadOAuthState,
  clearOAuthState: mockClearOAuthState,
}));

vi.mock("../../../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../../lib/xero-auth", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/xero-auth")>(
    "../../../../lib/xero-auth",
  );
  return { getAuthMode: actual.getAuthMode, exchangeAuthorizationCode: mockExchange };
});

import { GET } from "./callback";

const TENANT = "11111111-2222-3333-4444-555555555555";

function call(query: string): Promise<Response> {
  const request = new Request(`https://members.example.org/api/xero/oauth/callback${query}`);
  return GET({ request } as Parameters<typeof GET>[0]) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.XERO_AUTH_MODE = "authcode";
  mockClearOAuthState.mockResolvedValue(undefined);
  mockExchange.mockResolvedValue(TENANT);
  mockReadOAuthState.mockResolvedValue("nonce_123");
});

describe("GET /api/xero/oauth/callback", () => {
  it("exchanges the code and consumes the nonce on success", async () => {
    const res = await call("?code=code_abc&state=nonce_123");

    expect(res.status).toBe(200);
    expect(mockExchange).toHaveBeenCalledWith("code_abc");
    expect(mockClearOAuthState).toHaveBeenCalledTimes(1);
  });

  it("never echoes the code or nonce into the response body", async () => {
    const body = await (await call("?code=code_abc&state=nonce_123")).text();

    expect(body).not.toContain("code_abc");
    expect(body).not.toContain("nonce_123");
  });

  it("400s on a state mismatch without exchanging anything", async () => {
    mockReadOAuthState.mockResolvedValue("nonce_expected");

    const res = await call("?code=code_abc&state=nonce_attacker");

    expect(res.status).toBe(400);
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("400s when no nonce is stored at all (replayed callback)", async () => {
    mockReadOAuthState.mockResolvedValue(null);

    const res = await call("?code=code_abc&state=nonce_123");

    expect(res.status).toBe(400);
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("explains the concurrent-consent case rather than a bare invalid-state", async () => {
    // The nonce lives in one shared row, so overlapping consents clobber
    // each other; the operator needs to know that is what happened.
    mockReadOAuthState.mockResolvedValue("nonce_other");

    const body = await (await call("?code=code_abc&state=nonce_123")).text();

    expect(body).toMatch(/second consent attempt|stale|replayed/i);
  });

  it("400s when code or state is missing", async () => {
    expect((await call("?state=nonce_123")).status).toBe(400);
    expect((await call("?code=code_abc")).status).toBe(400);
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("reports a declined consent from Xero's error parameter", async () => {
    const res = await call("?error=access_denied");
    const body = await res.text();

    expect(res.status).toBe(400);
    expect(body).toContain("access_denied");
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("400s and keeps the nonce when the exchange fails, so consent can be retried", async () => {
    mockExchange.mockRejectedValueOnce(new Error("XERO_TENANT_MISMATCH: wrong org"));

    const res = await call("?code=code_abc&state=nonce_123");

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("XERO_TENANT_MISMATCH");
    expect(mockClearOAuthState).not.toHaveBeenCalled();
  });

  it("404s in custom-connection mode", async () => {
    process.env.XERO_AUTH_MODE = "custom";

    const res = await call("?code=code_abc&state=nonce_123");

    expect(res.status).toBe(404);
    expect(mockExchange).not.toHaveBeenCalled();
  });
});
