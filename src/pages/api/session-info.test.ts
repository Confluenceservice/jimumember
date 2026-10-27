import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSessionsRetrieve = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn(function () {
    return { checkout: { sessions: { retrieve: mockSessionsRetrieve } } };
  }),
}));

import { GET } from "./session-info";

async function call(sessionId: string | null) {
  const url = new URL(
    sessionId
      ? `https://app.test/api/session-info?session_id=${sessionId}`
      : "https://app.test/api/session-info",
  );
  return GET({ request: new Request(url) } as any);
}

describe("GET /api/session-info (characterization)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test";
  });

  it("returns plan, name, phone, email, amount and customerId from the session", async () => {
    mockSessionsRetrieve.mockResolvedValue({
      metadata: { plan: "basic", first_name: "Ann", last_name: "Lee", phone: "021" },
      customer_email: "a@b.test",
      amount_total: 4588,
      customer: "cus_1",
    });
    const res = await call("cs_1");
    expect(res.status).toBe(200);
    expect(mockSessionsRetrieve).toHaveBeenCalledWith("cs_1", { expand: ["line_items"] });
    expect(await res.json()).toEqual({
      plan: "basic",
      firstName: "Ann",
      lastName: "Lee",
      phone: "021",
      email: "a@b.test",
      amount: 4588,
      customerId: "cus_1",
    });
  });

  it("reads customerId from an expanded customer object", async () => {
    mockSessionsRetrieve.mockResolvedValue({ metadata: {}, customer: { id: "cus_2" } });
    const body = await (await call("cs_2")).json();
    expect(body.customerId).toBe("cus_2");
    expect(body.plan).toBeNull();
  });

  it("unknown session is a 404", async () => {
    mockSessionsRetrieve.mockRejectedValue(new Error("No such session"));
    const res = await call("cs_x");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Session not found.");
  });

  it("missing session_id is a 400", async () => {
    const res = await call(null);
    expect(res.status).toBe(400);
  });

  it("missing STRIPE_SECRET_KEY is a 500", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await call("cs_1");
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Server misconfiguration.");
  });
});
