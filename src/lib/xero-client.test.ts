import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAccessToken, mockInvalidateAccessToken } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockInvalidateAccessToken: vi.fn(),
}));

vi.mock("./xero-auth", () => ({
  getXeroAuth: () => ({ getAccessToken: mockGetAccessToken }),
  invalidateAccessToken: mockInvalidateAccessToken,
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  XeroApiError,
  createContact,
  createInvoice,
  createPayment,
  findContactByNumber,
  findInvoiceByNumber,
  getConnections,
  getTaxRates,
} from "./xero-client";

const TENANT = "11111111-2222-3333-4444-555555555555";

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json, text: async () => "", headers: new Headers() };
}

function fail(status: number, body = "", headers: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
    headers: new Headers(headers),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockGetAccessToken.mockResolvedValue({ accessToken: "at_live", tenantId: TENANT });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("request headers", () => {
  it("sends bearer token, tenant id and Accept on reads", async () => {
    fetchMock.mockResolvedValueOnce(ok({ TaxRates: [] }));

    await getTaxRates();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.xero.com/api.xro/2.0/TaxRates");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer at_live");
    expect(init.headers["Xero-Tenant-Id"]).toBe(TENANT);
    expect(init.headers.Accept).toBe("application/json");
  });

  it("omits Content-Type on reads and sets it on writes", async () => {
    fetchMock.mockResolvedValueOnce(ok({ TaxRates: [] }));
    await getTaxRates();
    expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBeUndefined();

    fetchMock.mockResolvedValueOnce(ok({ Contacts: [{ ContactID: "c1" }] }));
    await createContact({ Name: "A" });
    expect(fetchMock.mock.calls[1][1].headers["Content-Type"]).toBe("application/json");
  });

  it("calls /connections on its own host, outside the /api.xro/2.0 base", async () => {
    fetchMock.mockResolvedValueOnce(ok([{ id: "conn_1", tenantId: TENANT }]));

    const result = await getConnections();

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.xero.com/connections");
    expect(result[0].tenantId).toBe(TENANT);
  });
});

describe("where-clause construction", () => {
  it("filters contacts on ContactNumber, not Name", async () => {
    fetchMock.mockResolvedValueOnce(ok({ Contacts: [{ ContactID: "c1" }] }));

    await findContactByNumber("member@example.com");

    const url = fetchMock.mock.calls[0][0] as string;
    expect(decodeURIComponent(url)).toContain('where=ContactNumber=="member@example.com"');
    expect(url).not.toContain("Name");
  });

  it("rejects a value that could break out of the predicate", async () => {
    // No escape syntax we can rely on, so reject rather than mangle.
    await expect(findContactByNumber('a" OR Name!="')).rejects.toThrow(/XERO_UNSAFE_FILTER/);
    await expect(findInvoiceByNumber("cs_test\nInvoiceNumbers=x")).rejects.toThrow(
      /XERO_UNSAFE_FILTER/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies an unsafe filter as permanent — retrying cannot help", async () => {
    await expect(findContactByNumber('bad"value')).rejects.toMatchObject({ permanent: true });
  });

  it("returns null rather than throwing when nothing matches", async () => {
    fetchMock.mockResolvedValueOnce(ok({ Contacts: [] }));
    expect(await findContactByNumber("nobody@example.com")).toBeNull();

    fetchMock.mockResolvedValueOnce(ok({}));
    expect(await findInvoiceByNumber("cs_missing")).toBeNull();
  });

  it("surfaces AmountDue and Payments so a half-finished push can resume", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ Invoices: [{ InvoiceID: "inv1", AmountDue: 120, Payments: [] }] }),
    );

    const invoice = await findInvoiceByNumber("cs_test_123");

    expect(invoice?.AmountDue).toBe(120);
    expect(invoice?.Payments).toEqual([]);
  });
});

describe("401 handling", () => {
  it("invalidates the cached token and retries exactly once", async () => {
    fetchMock
      .mockResolvedValueOnce(fail(401))
      .mockResolvedValueOnce(ok({ TaxRates: [{ TaxType: "NONE" }] }));

    const result = await getTaxRates();

    expect(result).toEqual([{ TaxType: "NONE" }]);
    expect(mockInvalidateAccessToken).toHaveBeenCalledTimes(1);
    expect(mockGetAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second 401 instead of looping", async () => {
    fetchMock.mockResolvedValue(fail(401, "unauthorized"));

    await expect(getTaxRates()).rejects.toThrow(/XERO_API_401/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("429 handling", () => {
  it("waits out a short Retry-After and retries once", async () => {
    fetchMock
      .mockResolvedValueOnce(fail(429, "", { "Retry-After": "2" }))
      .mockResolvedValueOnce(ok({ TaxRates: [] }));

    const promise = getTaxRates();
    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("defers a long Retry-After to the sweeper rather than stalling the webhook", async () => {
    // Sleeping here would blow Stripe's request timeout.
    fetchMock.mockResolvedValueOnce(fail(429, "", { "Retry-After": "120" }));

    const err = await getTaxRates().catch((e) => e);

    expect(err).toBeInstanceOf(XeroApiError);
    expect(err.permanent).toBe(false);
    expect(err.message).toMatch(/deferred/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to a default wait when Retry-After is absent or junk", async () => {
    fetchMock
      .mockResolvedValueOnce(fail(429, "", { "Retry-After": "not-a-number" }))
      .mockResolvedValueOnce(ok({ TaxRates: [] }));

    const promise = getTaxRates();
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("transient vs permanent classification", () => {
  it("marks 5xx transient so the sweeper retries", async () => {
    fetchMock.mockResolvedValueOnce(fail(503, "upstream down"));

    const err = await getTaxRates().catch((e) => e);

    expect(err.status).toBe(503);
    expect(err.permanent).toBe(false);
  });

  it("marks a 400 validation failure permanent so it is not swept forever", async () => {
    fetchMock.mockResolvedValueOnce(
      fail(400, '{"Elements":[{"ValidationErrors":[{"Message":"Account code 999 is invalid"}]}]}'),
    );

    const err = await createInvoice({ InvoiceNumber: "cs_1" }).catch((e) => e);

    expect(err.status).toBe(400);
    expect(err.permanent).toBe(true);
    // The body is our own payload echoed back — the only way to debug a 400.
    expect(err.message).toContain("Account code 999 is invalid");
  });

  it("marks 403 permanent", async () => {
    fetchMock.mockResolvedValueOnce(fail(403, "forbidden"));
    await expect(getTaxRates()).rejects.toMatchObject({ permanent: true });
  });

  it("marks 404 permanent", async () => {
    fetchMock.mockResolvedValueOnce(fail(404, "not found"));
    await expect(getTaxRates()).rejects.toMatchObject({ permanent: true });
  });

  it("truncates a large error body rather than logging it whole", async () => {
    fetchMock.mockResolvedValueOnce(fail(400, "x".repeat(5000)));

    const err = await getTaxRates().catch((e) => e);

    expect(err.message.length).toBeLessThan(700);
  });
});

describe("write helpers", () => {
  it("wraps and unwraps the plural envelope for each resource", async () => {
    fetchMock.mockResolvedValueOnce(ok({ Contacts: [{ ContactID: "c1" }] }));
    expect((await createContact({ Name: "A" })).ContactID).toBe("c1");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ Contacts: [{ Name: "A" }] });

    fetchMock.mockResolvedValueOnce(ok({ Invoices: [{ InvoiceID: "i1" }] }));
    expect((await createInvoice({ InvoiceNumber: "cs_1" })).InvoiceID).toBe("i1");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      Invoices: [{ InvoiceNumber: "cs_1" }],
    });

    fetchMock.mockResolvedValueOnce(ok({ Payments: [{ PaymentID: "p1" }] }));
    expect((await createPayment({ Amount: 1 })).PaymentID).toBe("p1");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ Payments: [{ Amount: 1 }] });
  });

  it("treats a 2xx with no id as transient — the sweeper re-checks before re-creating", async () => {
    // Safe to retry precisely because pushOne calls
    // findInvoiceByNumber first, so a re-drive cannot double-create.
    fetchMock.mockResolvedValueOnce(ok({ Invoices: [] }));

    const err = await createInvoice({ InvoiceNumber: "cs_1" }).catch((e) => e);

    expect(err).toBeInstanceOf(XeroApiError);
    expect(err.permanent).toBe(false);
    expect(err.message).toMatch(/XERO_INVOICE_CREATE_NO_ID/);
  });
});
