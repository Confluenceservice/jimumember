import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSweepPending, mockIsXeroEnabled } = vi.hoisted(() => ({
  mockSweepPending: vi.fn(),
  mockIsXeroEnabled: vi.fn(),
}));

vi.mock("../../../lib/xero-sync", () => ({
  sweepPending: mockSweepPending,
  isXeroEnabled: mockIsXeroEnabled,
}));

vi.mock("../../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from "./sync-pending";

const SECRET = "sync-secret-value";

function call(
  { secret, query = "" }: { secret?: string; query?: string } = {},
): Promise<Response> {
  const headers = new Headers();
  if (secret !== undefined) headers.set("X-Sync-Secret", secret);
  const request = new Request(
    `https://members.example.org/api/xero/sync-pending${query}`,
    { headers },
  );
  return GET({ request } as Parameters<typeof GET>[0]) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.XERO_SYNC_SECRET = SECRET;
  mockIsXeroEnabled.mockReturnValue(true);
  mockSweepPending.mockResolvedValue({
    swept: 3,
    done: 2,
    stillPending: 1,
    permanentFailures: 0,
  });
});

describe("auth", () => {
  it("sweeps and returns the counts with a valid secret", async () => {
    const res = await call({ secret: SECRET });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: true,
      swept: 3,
      done: 2,
      stillPending: 1,
      permanentFailures: 0,
    });
    expect(mockSweepPending).toHaveBeenCalledTimes(1);
  });

  it("401s with no secret header", async () => {
    const res = await call();

    expect(res.status).toBe(401);
    expect(mockSweepPending).not.toHaveBeenCalled();
  });

  it("401s with the wrong secret", async () => {
    const res = await call({ secret: "nope" });

    expect(res.status).toBe(401);
    expect(mockSweepPending).not.toHaveBeenCalled();
  });

  it("401s when XERO_SYNC_SECRET is unset — absent must never mean open", async () => {
    delete process.env.XERO_SYNC_SECRET;

    const res = await call({ secret: "anything" });

    expect(res.status).toBe(401);
    expect(mockSweepPending).not.toHaveBeenCalled();
  });

  it("401s when BOTH the header and the secret are absent", async () => {
    // The fail-open hole a naive `provided === expected` leaves: null equals
    // null, and the endpoint opens to any caller on a misconfigured deploy.
    delete process.env.XERO_SYNC_SECRET;

    const res = await call();

    expect(res.status).toBe(401);
    expect(mockSweepPending).not.toHaveBeenCalled();
  });

  it("401s on an empty-string secret against an empty-string env var", async () => {
    process.env.XERO_SYNC_SECRET = "";

    const res = await call({ secret: "" });

    expect(res.status).toBe(401);
  });

  it("401s on a same-length wrong secret (constant-time path still rejects)", async () => {
    const res = await call({ secret: "x".repeat(SECRET.length) });

    expect(res.status).toBe(401);
  });
});

describe("kill switch", () => {
  it("reports enabled:false rather than 404ing, so the trigger log is legible", async () => {
    mockIsXeroEnabled.mockReturnValue(false);

    const res = await call({ secret: SECRET });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false, swept: 0 });
    expect(mockSweepPending).not.toHaveBeenCalled();
  });

  it("checks auth before the kill switch, so an unauthorised caller learns nothing", async () => {
    mockIsXeroEnabled.mockReturnValue(false);

    const res = await call({ secret: "nope" });

    expect(res.status).toBe(401);
    expect(mockIsXeroEnabled).not.toHaveBeenCalled();
  });
});

describe("limit", () => {
  it("defaults to 20", async () => {
    await call({ secret: SECRET });
    expect(mockSweepPending).toHaveBeenCalledWith(20);
  });

  it("honours an explicit limit", async () => {
    await call({ secret: SECRET, query: "?limit=5" });
    expect(mockSweepPending).toHaveBeenCalledWith(5);
  });

  it("caps the limit so one sweep cannot overlap the next trigger", async () => {
    await call({ secret: SECRET, query: "?limit=100000" });
    expect(mockSweepPending).toHaveBeenCalledWith(100);
  });

  it("falls back to the default on junk input", async () => {
    for (const q of ["?limit=abc", "?limit=-1", "?limit=0", "?limit=1.5"]) {
      mockSweepPending.mockClear();
      await call({ secret: SECRET, query: q });
      expect(mockSweepPending).toHaveBeenCalledWith(20);
    }
  });
});

describe("failure", () => {
  it("500s when the sweep fails structurally, so the trigger log shows it", async () => {
    mockSweepPending.mockRejectedValueOnce(new Error("MISSING_CONFIG: SPREADSHEET_ID"));

    const res = await call({ secret: SECRET });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("MISSING_CONFIG");
  });
});
