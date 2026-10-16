import { beforeEach, describe, expect, it, vi } from "vitest";

// xero-token-store.ts consumes the shared google-sheets-helpers surface;
// mock that module directly (tab management + retry are covered by
// google-sheets-helpers.test.ts, not re-tested here).
const { mockEnsureSheetWithHeaders, mockReadRange, mockUpdateRange, mockLogInfo, mockLogWarn } =
  vi.hoisted(() => ({
    mockEnsureSheetWithHeaders: vi.fn(),
    mockReadRange: vi.fn(),
    mockUpdateRange: vi.fn(),
    mockLogInfo: vi.fn(),
    mockLogWarn: vi.fn(),
  }));

vi.mock("./google-sheets-helpers", () => ({
  _resetSheetsClientCacheForTesting: vi.fn(),
  ensureSheetWithHeaders: mockEnsureSheetWithHeaders,
  readRange: mockReadRange,
  updateRange: mockUpdateRange,
}));

vi.mock("./logger", () => ({
  logger: { info: mockLogInfo, warn: mockLogWarn, error: vi.fn(), debug: vi.fn() },
}));

import {
  clearOAuthState,
  readOAuthState,
  readRefreshToken,
  writeOAuthState,
  writeRefreshToken,
} from "./xero-token-store";

const HEADERS = ["refresh_token", "obtained_at", "rotated_at", "oauth_state"];
const ROW_RANGE = "'Xero Auth'!A2:D2";

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureSheetWithHeaders.mockResolvedValue(undefined);
  mockUpdateRange.mockResolvedValue(undefined);
  mockReadRange.mockResolvedValue([]);
});

describe("readRefreshToken", () => {
  it("returns the token from A2", async () => {
    mockReadRange.mockResolvedValueOnce([["rt_abc", "2026-08-01T00:00:00.000Z", "", ""]]);

    const result = await readRefreshToken();

    expect(result).toBe("rt_abc");
    expect(mockEnsureSheetWithHeaders).toHaveBeenCalledWith("Xero Auth", HEADERS);
    expect(mockReadRange).toHaveBeenCalledWith(ROW_RANGE);
  });

  it("returns null when the row is absent (fresh tab)", async () => {
    mockReadRange.mockResolvedValueOnce([]);

    expect(await readRefreshToken()).toBeNull();
  });

  it("returns null when the token cell is empty", async () => {
    mockReadRange.mockResolvedValueOnce([["", "", "", "state_xyz"]]);

    expect(await readRefreshToken()).toBeNull();
  });

  it("returns null when the read throws", async () => {
    mockReadRange.mockRejectedValueOnce(new Error("Sheet 503"));

    expect(await readRefreshToken()).toBeNull();
  });

  it("returns null when the tab ensure throws (e.g. MISSING_CONFIG)", async () => {
    mockEnsureSheetWithHeaders.mockRejectedValueOnce(
      new Error("MISSING_CONFIG: GOOGLE_SHEETS_SPREADSHEET_ID"),
    );

    expect(await readRefreshToken()).toBeNull();
    expect(mockReadRange).not.toHaveBeenCalled();
  });
});

describe("writeRefreshToken", () => {
  it("writes the token to row 2 via updateRange, never append", async () => {
    mockReadRange.mockResolvedValueOnce([]);

    await writeRefreshToken("rt_new");

    expect(mockUpdateRange).toHaveBeenCalledTimes(1);
    const [range, values] = mockUpdateRange.mock.calls[0];
    expect(range).toBe(ROW_RANGE);
    expect(values).toHaveLength(1);
    expect(values[0][0]).toBe("rt_new");
  });

  it("stamps obtained_at on first write and mirrors it into rotated_at", async () => {
    mockReadRange.mockResolvedValueOnce([]);

    await writeRefreshToken("rt_first");

    const [, values] = mockUpdateRange.mock.calls[0];
    const [, obtainedAt, rotatedAt] = values[0];
    expect(obtainedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rotatedAt).toBe(obtainedAt);
  });

  it("preserves obtained_at and oauth_state across a rotation", async () => {
    mockReadRange.mockResolvedValueOnce([
      ["rt_old", "2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z", "state_xyz"],
    ]);

    await writeRefreshToken("rt_rotated");

    const [, values] = mockUpdateRange.mock.calls[0];
    const [token, obtainedAt, rotatedAt, state] = values[0];
    expect(token).toBe("rt_rotated");
    expect(obtainedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(state).toBe("state_xyz");
    expect(rotatedAt).not.toBe("2026-08-02T00:00:00.000Z");
    expect(rotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("still writes when the preserve-read fails, rather than skipping the write", async () => {
    mockReadRange.mockRejectedValueOnce(new Error("Sheet 503"));

    await writeRefreshToken("rt_new");

    expect(mockUpdateRange).toHaveBeenCalledTimes(1);
    const [, values] = mockUpdateRange.mock.calls[0];
    expect(values[0][0]).toBe("rt_new");
  });

  it("THROWS when the write fails — a swallowed rotation bricks the connection", async () => {
    mockReadRange.mockResolvedValueOnce([]);
    mockUpdateRange.mockRejectedValueOnce(new Error("Sheet 503"));

    await expect(writeRefreshToken("rt_new")).rejects.toThrow("Sheet 503");
  });

  it("THROWS on an empty token rather than blanking the stored one", async () => {
    await expect(writeRefreshToken("")).rejects.toThrow(/empty/i);
    expect(mockUpdateRange).not.toHaveBeenCalled();
  });

  it("does not pass the token value to the logger", async () => {
    mockReadRange.mockResolvedValueOnce([]);

    await writeRefreshToken("rt_supersecret");

    expect(mockLogInfo).toHaveBeenCalled();
    const allLogArgs = [...mockLogInfo.mock.calls, ...mockLogWarn.mock.calls];
    expect(JSON.stringify(allLogArgs)).not.toContain("rt_supersecret");
  });
});

describe("oauth state", () => {
  it("writes the nonce to D2 while preserving the token columns", async () => {
    mockReadRange.mockResolvedValueOnce([
      ["rt_abc", "2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z", ""],
    ]);

    await writeOAuthState("nonce_123");

    const [range, values] = mockUpdateRange.mock.calls[0];
    expect(range).toBe(ROW_RANGE);
    expect(values[0]).toEqual([
      "rt_abc",
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "nonce_123",
    ]);
  });

  it("reads the nonce back from D2", async () => {
    mockReadRange.mockResolvedValueOnce([["rt_abc", "", "", "nonce_123"]]);

    expect(await readOAuthState()).toBe("nonce_123");
  });

  it("returns null when no nonce is stored", async () => {
    mockReadRange.mockResolvedValueOnce([["rt_abc", "", "", ""]]);

    expect(await readOAuthState()).toBeNull();
  });

  it("returns null when the read throws", async () => {
    mockReadRange.mockRejectedValueOnce(new Error("Sheet 503"));

    expect(await readOAuthState()).toBeNull();
  });

  it("clears the nonce without disturbing the refresh token", async () => {
    mockReadRange.mockResolvedValueOnce([
      ["rt_abc", "2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z", "nonce_123"],
    ]);

    await clearOAuthState();

    const [, values] = mockUpdateRange.mock.calls[0];
    expect(values[0]).toEqual([
      "rt_abc",
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "",
    ]);
  });

  it("swallows clear failures — a stale nonce is rejected by the state check anyway", async () => {
    mockReadRange.mockResolvedValueOnce([["rt_abc", "", "", "nonce_123"]]);
    mockUpdateRange.mockRejectedValueOnce(new Error("Sheet 503"));

    await expect(clearOAuthState()).resolves.toBeUndefined();
  });
});
