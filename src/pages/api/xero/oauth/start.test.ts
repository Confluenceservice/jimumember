import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockWriteOAuthState, mockBuildConsentUrl } = vi.hoisted(() => ({
  mockWriteOAuthState: vi.fn(),
  mockBuildConsentUrl: vi.fn(),
}));

vi.mock("../../../../lib/xero-token-store", () => ({
  writeOAuthState: mockWriteOAuthState,
}));

vi.mock("../../../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../../lib/xero-auth", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/xero-auth")>(
    "../../../../lib/xero-auth",
  );
  return { getAuthMode: actual.getAuthMode, buildConsentUrl: mockBuildConsentUrl };
});

import { GET } from "./start";

const SECRET = "consent-secret-value";

function call(query: string): Promise<Response> {
  const request = new Request(`https://members.example.org/api/xero/oauth/start${query}`);
  return GET({ request } as Parameters<typeof GET>[0]) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.XERO_AUTH_MODE = "authcode";
  process.env.XERO_CONSENT_SECRET = SECRET;
  mockWriteOAuthState.mockResolvedValue(undefined);
  mockBuildConsentUrl.mockReturnValue("https://login.xero.com/identity/connect/authorize?x=1");
});

afterEach(() => {
  delete process.env.XERO_CONSENT_SECRET;
});

describe("GET /api/xero/oauth/start", () => {
  it("redirects to Xero with a freshly stored state nonce", async () => {
    const res = await call(`?secret=${SECRET}`);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("login.xero.com");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mockWriteOAuthState).toHaveBeenCalledTimes(1);
    // The nonce handed to the store is the one embedded in the consent URL.
    expect(mockBuildConsentUrl).toHaveBeenCalledWith(mockWriteOAuthState.mock.calls[0][0]);
  });

  it("mints a different nonce on each run", async () => {
    await call(`?secret=${SECRET}`);
    await call(`?secret=${SECRET}`);

    expect(mockWriteOAuthState.mock.calls[0][0]).not.toBe(
      mockWriteOAuthState.mock.calls[1][0],
    );
  });

  it("401s without the secret", async () => {
    const res = await call("");

    expect(res.status).toBe(401);
    expect(mockWriteOAuthState).not.toHaveBeenCalled();
  });

  it("401s with a wrong secret", async () => {
    const res = await call("?secret=nope");

    expect(res.status).toBe(401);
    expect(mockWriteOAuthState).not.toHaveBeenCalled();
  });

  it("401s when XERO_CONSENT_SECRET is unset — absent must never mean open", async () => {
    delete process.env.XERO_CONSENT_SECRET;

    const res = await call("?secret=anything");

    expect(res.status).toBe(401);
    expect(mockWriteOAuthState).not.toHaveBeenCalled();
  });

  it("404s in custom-connection mode, which needs no consent", async () => {
    process.env.XERO_AUTH_MODE = "custom";

    const res = await call(`?secret=${SECRET}`);

    expect(res.status).toBe(404);
    expect(mockWriteOAuthState).not.toHaveBeenCalled();
  });

  it("404s when the mode is unset rather than leaking a config error", async () => {
    delete process.env.XERO_AUTH_MODE;

    expect((await call(`?secret=${SECRET}`)).status).toBe(404);
  });

  it("500s rather than redirecting when the nonce cannot be stored", async () => {
    // A callback whose nonce was never persisted can never be matched.
    mockWriteOAuthState.mockRejectedValueOnce(new Error("Sheet 503"));

    const res = await call(`?secret=${SECRET}`);

    expect(res.status).toBe(500);
  });
});
