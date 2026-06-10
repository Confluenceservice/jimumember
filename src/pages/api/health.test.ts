import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock googleapis — capture the OAuth2 constructor and refreshAccessToken calls.
// Use `function` (not arrow) so `new google.auth.OAuth2(...)` works.
const mockSetCredentials = vi.fn();
const mockRefreshAccessToken = vi.fn();
const OAuth2Ctor = vi.fn().mockImplementation(function (this: any) {
  this.setCredentials = mockSetCredentials;
  this.refreshAccessToken = mockRefreshAccessToken;
});

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: OAuth2Ctor,
    },
  },
}));

// Mock Stripe — control products.list behaviour per test.
const mockProductsList = vi.fn();
vi.mock("stripe", () => {
  const StripeCtor = vi.fn().mockImplementation(function (this: any) {
    this.products = { list: mockProductsList };
  });
  return { default: StripeCtor };
});

vi.mock("../../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

async function getHandler() {
  const mod = await import("./health");
  return mod.GET;
}

describe("/api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply mockImplementation after clearAllMocks wipes it.
    OAuth2Ctor.mockImplementation(function (this: any) {
      this.setCredentials = mockSetCredentials;
      this.refreshAccessToken = mockRefreshAccessToken;
    });
    mockRefreshAccessToken.mockResolvedValue({
      credentials: { access_token: "ya29.fake" },
    });
    mockProductsList.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.GMAIL_OAUTH_CLIENT_ID;
    delete process.env.GMAIL_OAUTH_CLIENT_SECRET;
    delete process.env.GMAIL_OAUTH_REFRESH_TOKEN;
  });

  describe("happy path", () => {
    it("returns 200 with both subsystems connected", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_ok";
      process.env.GMAIL_OAUTH_CLIENT_ID = "cid";
      process.env.GMAIL_OAUTH_CLIENT_SECRET = "csec";
      process.env.GMAIL_OAUTH_REFRESH_TOKEN = "rt";

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "ok", stripe: "connected", gmail: "connected" });
    });
  });

  describe("Stripe", () => {
    it("returns not_configured when STRIPE_SECRET_KEY is absent", async () => {
      process.env.GMAIL_OAUTH_CLIENT_ID = "cid";
      process.env.GMAIL_OAUTH_CLIENT_SECRET = "csec";
      process.env.GMAIL_OAUTH_REFRESH_TOKEN = "rt";

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stripe).toBe("not_configured");
      expect(body.gmail).toBe("connected");
    });

    it("returns disconnected and 503 when products.list throws", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_bad";
      process.env.GMAIL_OAUTH_CLIENT_ID = "cid";
      process.env.GMAIL_OAUTH_CLIENT_SECRET = "csec";
      process.env.GMAIL_OAUTH_REFRESH_TOKEN = "rt";

      mockProductsList.mockRejectedValueOnce(new Error("Invalid API Key"));

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("degraded");
      expect(body.stripe).toBe("disconnected");
      expect(body.gmail).toBe("connected");
      expect(body.errors.stripe).toContain("Invalid API Key");
    });
  });

  describe("Gmail OAuth", () => {
    it("returns not_configured when any GMAIL_OAUTH_* env is missing", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_ok";
      // GMAIL_OAUTH_* envs deliberately omitted.

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.gmail).toBe("not_configured");
      expect(OAuth2Ctor).not.toHaveBeenCalled();
    });

    it("returns connected when refreshAccessToken resolves", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_ok";
      process.env.GMAIL_OAUTH_CLIENT_ID = "cid";
      process.env.GMAIL_OAUTH_CLIENT_SECRET = "csec";
      process.env.GMAIL_OAUTH_REFRESH_TOKEN = "rt";

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.gmail).toBe("connected");
      expect(OAuth2Ctor).toHaveBeenCalledWith("cid", "csec");
      expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: "rt" });
      expect(mockRefreshAccessToken).toHaveBeenCalledOnce();
    });

    it("returns disconnected and 503 on invalid_grant (dead refresh token)", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_ok";
      process.env.GMAIL_OAUTH_CLIENT_ID = "cid";
      process.env.GMAIL_OAUTH_CLIENT_SECRET = "csec";
      process.env.GMAIL_OAUTH_REFRESH_TOKEN = "dead";

      mockRefreshAccessToken.mockRejectedValueOnce(
        new Error('{"error":"invalid_grant","error_subtype":"invalid_rapt"}'),
      );

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("degraded");
      expect(body.gmail).toBe("disconnected");
      expect(body.stripe).toBe("connected");
      expect(body.errors.gmail).toContain("invalid_grant");
    });

    it("returns 503 when both subsystems are degraded", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_bad";
      process.env.GMAIL_OAUTH_CLIENT_ID = "cid";
      process.env.GMAIL_OAUTH_CLIENT_SECRET = "csec";
      process.env.GMAIL_OAUTH_REFRESH_TOKEN = "rt";

      mockProductsList.mockRejectedValueOnce(new Error("Stripe down"));
      mockRefreshAccessToken.mockRejectedValueOnce(new Error("Gmail down"));

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.stripe).toBe("disconnected");
      expect(body.gmail).toBe("disconnected");
      expect(body.errors.stripe).toContain("Stripe down");
      expect(body.errors.gmail).toContain("Gmail down");
    });
  });
});
