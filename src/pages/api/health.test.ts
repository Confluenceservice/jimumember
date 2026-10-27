import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const mockResolveStripePrice = vi.fn();
vi.mock("../../lib/payments/stripe/prices", () => ({
  resolveStripePrice: mockResolveStripePrice,
  invalidateStripePriceCache: vi.fn(),
}));

async function getHandler() {
  const mod = await import("./health");
  return mod.GET;
}

describe("/api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProductsList.mockResolvedValue({ data: [] });
    mockResolveStripePrice.mockImplementation(async (slug: string) => {
      if (slug === "advanced") return { priceRef: "price_adv_150", currency: "nzd", unitAmount: 15000 };
      return { priceRef: "price_basic_75", currency: "nzd", unitAmount: 7500 };
    });
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.MAILGUN_API_KEY;
    delete process.env.MAILGUN_DOMAIN;
    delete process.env.MAILGUN_FROM;
  });

  describe("happy path", () => {
    it("returns 200 with both subsystems connected", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_ok";
      process.env.MAILGUN_API_KEY = "key-test";
      process.env.MAILGUN_DOMAIN = "mg.example.com";
      process.env.MAILGUN_FROM = "JimuMember <no-reply@mg.example.com>";

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        status: "ok",
        stripe: "connected",
        email: "connected",
        renewal_prices: {
          advanced: { ok: true, priceId: "price_adv_150", currency: "nzd", unitAmount: 15000 },
          basic: { ok: true, priceId: "price_basic_75", currency: "nzd", unitAmount: 7500 },
        },
      });
    });
  });

  describe("payment provider selection", () => {
    afterEach(() => {
      delete process.env.PAYMENT_PROVIDER;
    });

    it("asks the provider for each tier's renewal price", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_ok";
      const GET = await getHandler();
      await GET({} as never);
      expect(mockResolveStripePrice).toHaveBeenCalledWith("advanced", "renewal");
      expect(mockResolveStripePrice).toHaveBeenCalledWith("basic", "renewal");
    });

    it("reports degraded (still 200) instead of crashing when PAYMENT_PROVIDER is invalid", async () => {
      process.env.PAYMENT_PROVIDER = "paypal";
      process.env.MAILGUN_API_KEY = "key-test";
      process.env.MAILGUN_DOMAIN = "mg.example.com";
      process.env.MAILGUN_FROM = "JimuMember <no-reply@mg.example.com>";

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("degraded");
      expect(body.stripe).toBe("not_configured");
      expect(body.errors.stripe).toContain('Unknown PAYMENT_PROVIDER "paypal"');
      expect(body.renewal_prices.basic.ok).toBe(false);
    });
  });

  describe("Stripe", () => {
    it("reports not_configured as degraded when STRIPE_SECRET_KEY is absent", async () => {
      process.env.MAILGUN_API_KEY = "key-test";
      process.env.MAILGUN_DOMAIN = "mg.example.com";
      process.env.MAILGUN_FROM = "JimuMember <no-reply@mg.example.com>";

      const GET = await getHandler();
      const res = await GET({} as never);

      // 200 keeps the Fly liveness check green; body.status carries readiness.
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("degraded");
      expect(body.stripe).toBe("not_configured");
      expect(body.email).toBe("connected");
    });

    it("reports disconnected and degraded (still 200) when products.list throws", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_bad";
      process.env.MAILGUN_API_KEY = "key-test";
      process.env.MAILGUN_DOMAIN = "mg.example.com";
      process.env.MAILGUN_FROM = "JimuMember <no-reply@mg.example.com>";

      mockProductsList.mockRejectedValueOnce(new Error("Invalid API Key"));

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("degraded");
      expect(body.stripe).toBe("disconnected");
      expect(body.email).toBe("connected");
      expect(body.errors.stripe).toContain("Invalid API Key");
    });
  });

  describe("Mailgun", () => {
    it("reports not_configured as degraded when any MAILGUN_* env is missing", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_ok";
      // MAILGUN_* envs deliberately omitted.

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("degraded");
      expect(body.email).toBe("not_configured");
    });

    it("reports not_configured when MAILGUN_FROM is missing (even if API_KEY + DOMAIN are set)", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_ok";
      process.env.MAILGUN_API_KEY = "key-test";
      process.env.MAILGUN_DOMAIN = "mg.example.com";
      // MAILGUN_FROM deliberately omitted.

      const GET = await getHandler();
      const res = await GET({} as never);

      const body = await res.json();
      expect(body.email).toBe("not_configured");
    });

    it("returns connected when all three MAILGUN_* envs are set (no network call)", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_ok";
      process.env.MAILGUN_API_KEY = "key-test";
      process.env.MAILGUN_DOMAIN = "mg.example.com";
      process.env.MAILGUN_FROM = "JimuMember <no-reply@mg.example.com>";

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.email).toBe("connected");
      expect(body.errors).toBeUndefined();
    });

    it("reports both subsystems degraded (still 200)", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_bad";
      process.env.MAILGUN_API_KEY = "key-test";
      process.env.MAILGUN_DOMAIN = "mg.example.com";
      process.env.MAILGUN_FROM = "JimuMember <no-reply@mg.example.com>";

      mockProductsList.mockRejectedValueOnce(new Error("Stripe down"));

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("degraded");
      expect(body.stripe).toBe("disconnected");
      expect(body.email).toBe("connected");
      expect(body.errors.stripe).toContain("Stripe down");
    });
  });

  describe("renewal_prices", () => {
    it("includes renewal_prices field with both tiers when prices resolve", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_ok";
      process.env.MAILGUN_API_KEY = "key-test";
      process.env.MAILGUN_DOMAIN = "mg.example.com";
      process.env.MAILGUN_FROM = "JimuMember <no-reply@mg.example.com>";

      const GET = await getHandler();
      const res = await GET({} as never);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.renewal_prices).toBeDefined();
      expect(body.renewal_prices.advanced).toEqual({
        ok: true,
        priceId: "price_adv_150",
        currency: "nzd",
        unitAmount: 15000,
      });
      expect(body.renewal_prices.basic).toEqual({
        ok: true,
        priceId: "price_basic_75",
        currency: "nzd",
        unitAmount: 7500,
      });
    });

    it("reports degraded when Basic tier fails to resolve and ok=false for that tier", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_ok";
      process.env.MAILGUN_API_KEY = "key-test";
      process.env.MAILGUN_DOMAIN = "mg.example.com";
      process.env.MAILGUN_FROM = "JimuMember <no-reply@mg.example.com>";

      mockResolveStripePrice.mockImplementation(async (slug: string) => {
        if (slug === "advanced") throw new Error("PRICE_INACTIVE: no active price");
        return { priceRef: "price_basic_75", currency: "nzd", unitAmount: 7500 };
      });

      const GET = await getHandler();
      const res = await GET({} as never);

      const body = await res.json();
      expect(body.renewal_prices.advanced.ok).toBe(false);
      expect(body.renewal_prices.advanced.error).toMatch(/PRICE_INACTIVE/);
      expect(body.renewal_prices.basic.ok).toBe(true);
      expect(body.status).toBe("degraded");
    });

    it("reports degraded when both tiers fail to resolve", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_ok";
      process.env.MAILGUN_API_KEY = "key-test";
      process.env.MAILGUN_DOMAIN = "mg.example.com";
      process.env.MAILGUN_FROM = "JimuMember <no-reply@mg.example.com>";

      mockResolveStripePrice.mockRejectedValue(new Error("MISSING_CONFIG: STRIPE_PRODUCT_PM_RENEWAL not set"));

      const GET = await getHandler();
      const res = await GET({} as never);

      const body = await res.json();
      expect(body.renewal_prices.advanced.ok).toBe(false);
      expect(body.renewal_prices.basic.ok).toBe(false);
      expect(body.status).toBe("degraded");
    });
  });
});
