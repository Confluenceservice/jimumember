import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockReadRefreshToken, mockWriteRefreshToken, mockLogWarn, mockLogError } = vi.hoisted(
  () => ({
    mockReadRefreshToken: vi.fn(),
    mockWriteRefreshToken: vi.fn(),
    mockLogWarn: vi.fn(),
    mockLogError: vi.fn(),
  }),
);

vi.mock("./xero-token-store", () => ({
  readRefreshToken: mockReadRefreshToken,
  writeRefreshToken: mockWriteRefreshToken,
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: mockLogWarn, error: mockLogError, debug: vi.fn() },
}));

import {
  _resetXeroAuthCacheForTesting,
  buildConsentUrl,
  exchangeAuthorizationCode,
  getAuthMode,
  getXeroAuth,
} from "./xero-auth";

const TENANT = "11111111-2222-3333-4444-555555555555";

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: "at_live",
      expires_in: 1800,
      ...overrides,
    }),
    text: async () => "",
  };
}

function connectionsResponse(tenantIds: string[] = [TENANT]) {
  return {
    ok: true,
    status: 200,
    json: async () => tenantIds.map((id) => ({ id: "conn_1", tenantId: id })),
    text: async () => "",
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  _resetXeroAuthCacheForTesting();
  process.env.XERO_CLIENT_ID = "client_id";
  process.env.XERO_CLIENT_SECRET = "client_secret";
  process.env.XERO_TENANT_ID = TENANT;
  process.env.XERO_REDIRECT_URI = "https://members.example.org/api/xero/oauth/callback";
  process.env.XERO_AUTH_MODE = "custom";
  mockWriteRefreshToken.mockResolvedValue(undefined);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAuthMode", () => {
  it("accepts custom and authcode, case-insensitively", () => {
    process.env.XERO_AUTH_MODE = "CUSTOM";
    expect(getAuthMode()).toBe("custom");
    process.env.XERO_AUTH_MODE = "authcode";
    expect(getAuthMode()).toBe("authcode");
  });

  it("throws on an unset or unknown mode", () => {
    delete process.env.XERO_AUTH_MODE;
    expect(() => getAuthMode()).toThrow(/MISSING_CONFIG/);
    process.env.XERO_AUTH_MODE = "oauth1";
    expect(() => getAuthMode()).toThrow(/MISSING_CONFIG/);
  });
});

describe("custom connection mode", () => {
  it("requests a client_credentials token and resolves the tenant", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(connectionsResponse());

    const result = await getXeroAuth().getAccessToken();

    expect(result).toEqual({ accessToken: "at_live", tenantId: TENANT });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://identity.xero.com/connect/token");
    expect(tokenInit.body).toContain("grant_type=client_credentials");
    expect(tokenInit.headers.Authorization).toBe(
      `Basic ${Buffer.from("client_id:client_secret").toString("base64")}`,
    );
  });

  it("does NOT request offline_access — client_credentials has no refresh token", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(connectionsResponse());

    await getXeroAuth().getAccessToken();

    expect(fetchMock.mock.calls[0][1].body).not.toContain("offline_access");
    expect(mockReadRefreshToken).not.toHaveBeenCalled();
    expect(mockWriteRefreshToken).not.toHaveBeenCalled();
  });

  it("reuses the cached token instead of hitting the network again", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(connectionsResponse());

    const auth = getXeroAuth();
    await auth.getAccessToken();
    const second = await auth.getAccessToken();

    expect(second.accessToken).toBe("at_live");
    expect(fetchMock).toHaveBeenCalledTimes(2); // token + connections, not repeated
  });

  it("refreshes once the safety margin has elapsed", async () => {
    // expires_in 30s is inside the 60s margin, so the token is born stale.
    fetchMock
      .mockResolvedValueOnce(tokenResponse({ expires_in: 30 }))
      .mockResolvedValueOnce(connectionsResponse())
      .mockResolvedValueOnce(tokenResponse({ access_token: "at_second" }))
      .mockResolvedValueOnce(connectionsResponse());

    const auth = getXeroAuth();
    await auth.getAccessToken();
    const second = await auth.getAccessToken();

    expect(second.accessToken).toBe("at_second");
  });

  it("surfaces the status but not the body when the token endpoint rejects", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "unauthorized_client",
      json: async () => ({}),
    });

    await expect(getXeroAuth().getAccessToken()).rejects.toThrow(/XERO_TOKEN_FAILED: 401/);
  });
});

describe("tenant guard", () => {
  it("throws when the token cannot see the expected org", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(connectionsResponse(["99999999-0000-0000-0000-000000000000"]));

    await expect(getXeroAuth().getAccessToken()).rejects.toThrow(/XERO_TENANT_MISMATCH/);
    expect(mockLogError).toHaveBeenCalledWith(
      "xero_auth.tenant_mismatch",
      expect.objectContaining({ expected: TENANT }),
    );
  });

  it("throws when XERO_TENANT_ID is unset rather than trusting any org", async () => {
    delete process.env.XERO_TENANT_ID;
    fetchMock.mockResolvedValueOnce(tokenResponse());

    await expect(getXeroAuth().getAccessToken()).rejects.toThrow(
      /MISSING_CONFIG: XERO_TENANT_ID/,
    );
  });
});

describe("authcode mode", () => {
  beforeEach(() => {
    process.env.XERO_AUTH_MODE = "authcode";
  });

  it("exchanges the stored refresh token and requests no other grant", async () => {
    mockReadRefreshToken.mockResolvedValue("rt_stored");
    fetchMock
      .mockResolvedValueOnce(tokenResponse({ refresh_token: "rt_rotated" }))
      .mockResolvedValueOnce(connectionsResponse());

    const result = await getXeroAuth().getAccessToken();

    expect(result.accessToken).toBe("at_live");
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=rt_stored");
  });

  it("persists the rotated refresh token BEFORE returning the access token", async () => {
    mockReadRefreshToken.mockResolvedValue("rt_stored");
    const order: string[] = [];
    mockWriteRefreshToken.mockImplementation(async () => {
      order.push("write");
    });
    fetchMock
      .mockResolvedValueOnce(tokenResponse({ refresh_token: "rt_rotated" }))
      .mockResolvedValueOnce(connectionsResponse());

    await getXeroAuth().getAccessToken();
    order.push("returned");

    expect(mockWriteRefreshToken).toHaveBeenCalledWith("rt_rotated");
    expect(order).toEqual(["write", "returned"]);
  });

  it("fails the refresh when the rotated token cannot be persisted", async () => {
    // Handing back an access token whose successor we just lost would
    // silently brick the connection at the next refresh.
    mockReadRefreshToken.mockResolvedValue("rt_stored");
    mockWriteRefreshToken.mockRejectedValueOnce(new Error("Sheet 503"));
    fetchMock.mockResolvedValueOnce(tokenResponse({ refresh_token: "rt_rotated" }));

    await expect(getXeroAuth().getAccessToken()).rejects.toThrow("Sheet 503");
  });

  it("tells the operator how to reconnect when nothing is stored", async () => {
    mockReadRefreshToken.mockResolvedValue(null);

    await expect(getXeroAuth().getAccessToken()).rejects.toThrow(/XERO_NOT_CONNECTED/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("concurrency", () => {
  it("collapses parallel callers into exactly one refresh", async () => {
    // A second refresh would present a token the first already rotated away.
    process.env.XERO_AUTH_MODE = "authcode";
    mockReadRefreshToken.mockResolvedValue("rt_stored");
    fetchMock
      .mockResolvedValueOnce(tokenResponse({ refresh_token: "rt_rotated" }))
      .mockResolvedValueOnce(connectionsResponse());

    const auth = getXeroAuth();
    const results = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.getAccessToken(),
    ]);

    expect(results.every((r) => r.accessToken === "at_live")).toBe(true);
    expect(mockWriteRefreshToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one token call, one connections call
  });

  it("retries after a failed refresh instead of caching the rejection", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "", json: async () => ({}) })
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(connectionsResponse());

    const auth = getXeroAuth();
    await expect(auth.getAccessToken()).rejects.toThrow(/XERO_TOKEN_FAILED: 503/);

    const second = await auth.getAccessToken();
    expect(second.accessToken).toBe("at_live");
  });
});

describe("buildConsentUrl", () => {
  it("requests offline_access so Xero returns a refresh token at all", () => {
    const url = new URL(buildConsentUrl("nonce_123"));

    expect(url.origin + url.pathname).toBe("https://login.xero.com/identity/connect/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client_id");
    expect(url.searchParams.get("state")).toBe("nonce_123");
    expect(url.searchParams.get("scope")).toContain("offline_access");
  });
});

describe("exchangeAuthorizationCode", () => {
  it("persists the refresh token and returns the tenant", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse({ refresh_token: "rt_first" }))
      .mockResolvedValueOnce(connectionsResponse());

    const tenantId = await exchangeAuthorizationCode("code_abc");

    expect(tenantId).toBe(TENANT);
    expect(mockWriteRefreshToken).toHaveBeenCalledWith("rt_first");
    expect(fetchMock.mock.calls[0][1].body).toContain("grant_type=authorization_code");
  });

  it("writes NOTHING when consent granted access to the wrong org", async () => {
    // Mirror of the rotation ordering: there is no prior token to lose here,
    // so the tenant is verified before anything is persisted.
    fetchMock
      .mockResolvedValueOnce(tokenResponse({ refresh_token: "rt_first" }))
      .mockResolvedValueOnce(connectionsResponse(["99999999-0000-0000-0000-000000000000"]));

    await expect(exchangeAuthorizationCode("code_abc")).rejects.toThrow(/XERO_TENANT_MISMATCH/);
    expect(mockWriteRefreshToken).not.toHaveBeenCalled();
  });

  it("fails loudly when consent returned no refresh token", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(connectionsResponse());

    await expect(exchangeAuthorizationCode("code_abc")).rejects.toThrow(
      /XERO_NO_REFRESH_TOKEN/,
    );
    expect(mockWriteRefreshToken).not.toHaveBeenCalled();
  });
});
