import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock googleapis before importing the module under test
const mockAppend = vi.fn().mockResolvedValue({});
const jwtMock = vi.fn();
const mockSheets = vi.fn().mockReturnValue({
  spreadsheets: {
    values: {
      append: mockAppend,
    },
  },
});
vi.mock("googleapis", () => ({
  google: {
    auth: {
      JWT: jwtMock,
    },
    sheets: mockSheets,
  },
}));

describe("google-sheets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set valid env vars for all tests
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL = "test@eldaa-sheets.iam.gserviceaccount.com";
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY = "-----BEGIN PRIVATE KEY-----\ntest-key\n-----END PRIVATE KEY-----";
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "1Zbqn6BSExD5V9cPmA2rCJ2rN5f7gnP9fHjP0s5oq_I8";
  });

  afterEach(() => {
    delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY;
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  });

  // Re-import to pick up fresh env var state per test
  async function getAppendCheckoutLog() {
    const mod = await import("./google-sheets");
    return mod.appendCheckoutLog;
  }

  describe("appendCheckoutLog", () => {
    it("appends a correctly formatted row to the spreadsheet", async () => {
      const appendCheckoutLog = await getAppendCheckoutLog();

      await appendCheckoutLog({
        timestamp: "2026-03-28T10:00:00.000Z",
        firstName: "Jane",
        lastName: "Doe",
        phone: "+64 21 123 4567",
        email: "jane@example.com",
        plan: "associate",
        amountPaid: 7500,
        sessionId: "cs_test_abc123",
        customerId: "cus_xyz789",
      });

      expect(mockAppend).toHaveBeenCalledOnce();
      expect(mockAppend).toHaveBeenCalledWith({
        spreadsheetId: "1Zbqn6BSExD5V9cPmA2rCJ2rN5f7gnP9fHjP0s5oq_I8",
        range: "A1:I1",
        valueInputOption: "RAW",
        requestBody: {
          values: [[
            "2026-03-28T10:00:00.000Z",
            "Jane",
            "Doe",
            "+64 21 123 4567",
            "jane@example.com",
            "associate",
            "NZ$75.00",
            "cs_test_abc123",
            "cus_xyz789",
          ]],
        },
      });
    });

    it("formats amountPaid in cents as NZ$ with two decimal places", async () => {
      const appendCheckoutLog = await getAppendCheckoutLog();

      await appendCheckoutLog({
        timestamp: "2026-03-28T10:00:00.000Z",
        firstName: "John",
        lastName: "Smith",
        phone: "",
        email: "john@example.com",
        plan: "professional",
        amountPaid: 14999, // $149.99
        sessionId: "cs_test_xyz",
        customerId: "cus_abc",
      });

      const call = mockAppend.mock.calls[0][0];
      expect(call.requestBody.values[0][6]).toBe("NZ$149.99");
    });

    it("throws when GOOGLE_SHEETS_SPREADSHEET_ID is missing", async () => {
      delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
      const appendCheckoutLog = await getAppendCheckoutLog();

      await expect(appendCheckoutLog({
        timestamp: "2026-03-28T10:00:00.000Z",
        firstName: "Jane",
        lastName: "Doe",
        phone: "",
        email: "jane@example.com",
        plan: "associate",
        amountPaid: 7500,
        sessionId: "cs_test",
        customerId: "cus_test",
      })).rejects.toThrow("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
    });

    it("throws when GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL is missing", async () => {
      delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
      const appendCheckoutLog = await getAppendCheckoutLog();

      await expect(appendCheckoutLog({
        timestamp: "2026-03-28T10:00:00.000Z",
        firstName: "Jane",
        lastName: "Doe",
        phone: "",
        email: "jane@example.com",
        plan: "associate",
        amountPaid: 7500,
        sessionId: "cs_test",
        customerId: "cus_test",
      })).rejects.toThrow("Missing GOOGLE_SHEETS service account config.");
    });

    it("throws when GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY is missing", async () => {
      delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY;
      const appendCheckoutLog = await getAppendCheckoutLog();

      await expect(appendCheckoutLog({
        timestamp: "2026-03-28T10:00:00.000Z",
        firstName: "Jane",
        lastName: "Doe",
        phone: "",
        email: "jane@example.com",
        plan: "associate",
        amountPaid: 7500,
        sessionId: "cs_test",
        customerId: "cus_test",
      })).rejects.toThrow("Missing GOOGLE_SHEETS service account config.");
    });

    it("succeeds with zero amountPaid", async () => {
      const appendCheckoutLog = await getAppendCheckoutLog();

      await appendCheckoutLog({
        timestamp: "2026-03-28T10:00:00.000Z",
        firstName: "Jane",
        lastName: "Doe",
        phone: "",
        email: "jane@example.com",
        plan: "associate",
        amountPaid: 0,
        sessionId: "cs_test",
        customerId: "cus_test",
      });

      const call = mockAppend.mock.calls[0][0];
      expect(call.requestBody.values[0][6]).toBe("NZ$0.00");
    });

    it("handles missing optional fields gracefully", async () => {
      const appendCheckoutLog = await getAppendCheckoutLog();

      await appendCheckoutLog({
        timestamp: "2026-03-28T10:00:00.000Z",
        firstName: "",
        lastName: "",
        phone: "",
        email: "",
        plan: "",
        amountPaid: 0,
        sessionId: "",
        customerId: "",
      });

      expect(mockAppend).toHaveBeenCalledOnce();
    });
  });
});
