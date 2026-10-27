import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPricesRetrieve = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn(function () {
    return { prices: { retrieve: mockPricesRetrieve } };
  }),
}));
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from "./get-prices";

async function call() {
  return GET({ request: new Request("https://app.test/api/get-prices") } as any);
}

describe("GET /api/get-prices (characterization)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_1 = "price_basic";
    process.env.STRIPE_PRICE_2 = "price_adv";
    mockPricesRetrieve.mockImplementation(async (id: string) => ({
      id,
      currency: "usd",
      unit_amount: id === "price_basic" ? 7500 : 15000,
    }));
  });

  it("returns amount and formatted price for basic and advanced", async () => {
    const body = await (await call()).json();
    expect(body.basic).toEqual({ amount: 7500, formatted: "$75.00" });
    expect(body.advanced).toEqual({ amount: 15000, formatted: "$150.00" });
  });

  it("skips a plan whose price retrieve throws", async () => {
    mockPricesRetrieve.mockImplementation(async (id: string) => {
      if (id === "price_adv") throw new Error("gone");
      return { id, currency: "usd", unit_amount: 7500 };
    });
    const body = await (await call()).json();
    expect(body.basic.amount).toBe(7500);
    expect(body.advanced).toBeUndefined();
  });

  it("skips a plan with no price env var", async () => {
    delete process.env.STRIPE_PRICE_1;
    const body = await (await call()).json();
    expect(body.basic).toBeUndefined();
    expect(body.advanced.amount).toBe(15000);
  });

  it("skips a price in the wrong currency", async () => {
    mockPricesRetrieve.mockResolvedValue({ id: "x", currency: "nzd", unit_amount: 7500 });
    const body = await (await call()).json();
    expect(body).toEqual({});
  });

  it("missing STRIPE_SECRET_KEY is a 500", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Server is missing STRIPE_SECRET_KEY.");
  });
});
