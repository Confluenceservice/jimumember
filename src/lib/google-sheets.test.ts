import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock googleapis before importing the module under test
const mockAppend = vi.fn().mockResolvedValue({});
const mockUpdate = vi.fn().mockResolvedValue({});
const mockGet = vi.fn().mockResolvedValue({ data: { values: [] } });
const mockSpreadsheetGet = vi.fn().mockResolvedValue({
  data: {
    sheets: [{ properties: { title: "Basic Applications", sheetId: 42 } }],
  },
});
const mockBatchUpdate = vi.fn().mockResolvedValue({});

// The shared client (google-sheets-helpers.ts) calls `auth.authorize()` to
// warm the OAuth token before returning the Sheets client, so `new
// google.auth.JWT(...)` must yield an object with that method. The
// implementation explicitly returns an object so `new` uses it directly,
// rather than relying on prototype-chain wiring (which `vi.fn()` mock
// constructors don't preserve).
const jwtMock = vi.fn().mockImplementation(function () {
  return { authorize: vi.fn().mockResolvedValue(undefined) };
});

const mockSheets = vi.fn().mockReturnValue({
  spreadsheets: {
    get: mockSpreadsheetGet,
    batchUpdate: mockBatchUpdate,
    values: {
      append: mockAppend,
      update: mockUpdate,
      get: mockGet,
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
  beforeEach(async () => {
    vi.clearAllMocks();
    // The shared client caches the auth-warmed Sheets client across calls;
    // reset it so each test gets a fresh construction (and so tests that
    // delete required env vars actually exercise the failure path instead of
    // reusing an already-successful prior test's cached client).
    const { _resetSheetsClientCacheForTesting } = await import("./google-sheets-helpers");
    _resetSheetsClientCacheForTesting();
    // Set valid env vars for all tests
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL = "test@remember-sheets.iam.gserviceaccount.com";
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
  async function getAppendAssociateApplication() {
    const mod = await import("./google-sheets");
    return mod.appendBasicApplication;
  }
  async function getAppendEmailLog() {
    const mod = await import("./google-sheets");
    return mod.appendEmailLog;
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
        plan: "basic",
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
            "basic",
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
        plan: "advanced",
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
        plan: "basic",
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
        plan: "basic",
        amountPaid: 7500,
        sessionId: "cs_test",
        customerId: "cus_test",
      })).rejects.toThrow("Missing GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL");
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
        plan: "basic",
        amountPaid: 7500,
        sessionId: "cs_test",
        customerId: "cus_test",
      })).rejects.toThrow("Missing GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL");
    });

    it("succeeds with zero amountPaid", async () => {
      const appendCheckoutLog = await getAppendCheckoutLog();

      await appendCheckoutLog({
        timestamp: "2026-03-28T10:00:00.000Z",
        firstName: "Jane",
        lastName: "Doe",
        phone: "",
        email: "jane@example.com",
        plan: "basic",
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

  describe("appendEmailLog", () => {
    it("appends a sent entry to the Email log sheet", async () => {
      const appendEmailLog = await getAppendEmailLog();

      await appendEmailLog({
        timestamp: "2026-06-01T09:00:00.000Z",
        to: "jane@example.com",
        subject: "Your Re:Member Advanced Membership Application",
        template: "confirmation",
        applicantId: "app_abc123",
        result: "sent",
      });

      expect(mockAppend).toHaveBeenCalledOnce();
      expect(mockAppend).toHaveBeenCalledWith({
        spreadsheetId: "1Zbqn6BSExD5V9cPmA2rCJ2rN5f7gnP9fHjP0s5oq_I8",
        range: "'Email log'!A1:G1",
        valueInputOption: "RAW",
        requestBody: {
          values: [[
            "2026-06-01T09:00:00.000Z",
            "jane@example.com",
            "Your Re:Member Advanced Membership Application",
            "confirmation",
            "app_abc123",
            "sent",
            "",
          ]],
        },
      });
    });

    it("appends a failed entry with error message", async () => {
      const appendEmailLog = await getAppendEmailLog();

      await appendEmailLog({
        timestamp: "2026-06-01T09:00:00.000Z",
        to: "jane@example.com",
        subject: "Your Re:Member Advanced Membership Application",
        template: "resume_link",
        applicantId: "app_abc123",
        result: "failed",
        error: "ENOTFOUND",
      });

      const call = mockAppend.mock.calls[0][0];
      expect(call.requestBody.values[0][5]).toBe("failed");
      expect(call.requestBody.values[0][6]).toBe("ENOTFOUND");
    });

    it("omits applicantId when not provided", async () => {
      const appendEmailLog = await getAppendEmailLog();

      await appendEmailLog({
        timestamp: "2026-06-01T09:00:00.000Z",
        to: "membership@example.com",
        subject: "New Advanced Membership Application — Jane Doe",
        template: "application_notification",
        result: "sent",
      });

      const call = mockAppend.mock.calls[0][0];
      expect(call.requestBody.values[0][4]).toBe("");
    });

    it("omits error when not provided", async () => {
      const appendEmailLog = await getAppendEmailLog();

      await appendEmailLog({
        timestamp: "2026-06-01T09:00:00.000Z",
        to: "bob@example.com",
        subject: "Welcome to Re:Member — Basic Membership Confirmed",
        template: "basic_confirmation",
        result: "sent",
      });

      const call = mockAppend.mock.calls[0][0];
      expect(call.requestBody.values[0][6]).toBe("");
    });

    it("throws when GOOGLE_SHEETS_SPREADSHEET_ID is missing", async () => {
      delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
      const appendEmailLog = await getAppendEmailLog();

      await expect(appendEmailLog({
        timestamp: "2026-06-01T09:00:00.000Z",
        to: "jane@example.com",
        subject: "Test",
        template: "confirmation",
        result: "sent",
      })).rejects.toThrow("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
    });
  });

  describe("appendBasicApplication", () => {
    it("writes Basic application data to the Basic Applications sheet", async () => {
      const appendBasicApplication = await getAppendAssociateApplication();

      await appendBasicApplication({
        submittedAt: "2026-05-11T06:30:00.000Z",
        applicationId: "app_123",
        firstName: "Alex",
        lastName: "Taylor",
        email: "alex@example.com",
        phone: "+64 21 000 0000",
        fullAddress: "1 Main St, Auckland",
        postalAddress: "PO Box 123",
        businessName: "Alex Care",
        interestJoining: "Community support",
        trainingDetails: "In training with provider X, expected 2026-11",
        listOnPage: "yes",
        listingDetails: "Alex Taylor, Alex Care, Auckland",
        signature: "Alex Taylor",
        applicationDate: "2026-05-11",
        checkoutStatus: "checkout_requested",
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        spreadsheetId: "1Zbqn6BSExD5V9cPmA2rCJ2rN5f7gnP9fHjP0s5oq_I8",
        range: "'Basic Applications'!A1:P1",
        valueInputOption: "RAW",
        requestBody: {
          values: [[
            "submitted_at",
            "application_id",
            "first_name",
            "last_name",
            "email",
            "phone",
            "full_address",
            "postal_address",
            "business_name",
            "interest_joining",
            "training_details",
            "list_on_page",
            "listing_details",
            "signature",
            "application_date",
            "checkout_status",
          ]],
        },
      });

      expect(mockAppend).toHaveBeenCalledWith({
        spreadsheetId: "1Zbqn6BSExD5V9cPmA2rCJ2rN5f7gnP9fHjP0s5oq_I8",
        range: "'Basic Applications'!A1:P1",
        valueInputOption: "RAW",
        requestBody: {
          values: [[
            "2026-05-11T06:30:00.000Z",
            "app_123",
            "Alex",
            "Taylor",
            "alex@example.com",
            "+64 21 000 0000",
            "1 Main St, Auckland",
            "PO Box 123",
            "Alex Care",
            "Community support",
            "In training with provider X, expected 2026-11",
            "yes",
            "Alex Taylor, Alex Care, Auckland",
            "Alex Taylor",
            "2026-05-11",
            "checkout_requested",
          ]],
        },
      });
    });
  });

  describe("readNotificationRules", () => {
    async function getReadNotificationRules() {
      const mod = await import("./google-sheets");
      return mod.readNotificationRules;
    }

    it("parses rows and drops those missing event or recipient", async () => {
      mockSpreadsheetGet.mockResolvedValueOnce({
        data: { sheets: [{ properties: { title: "Notification Rules" } }] },
      });
      mockGet.mockResolvedValueOnce({
        data: {
          values: [
            ["advanced_payment_received", "membership@club.org", "TRUE", "PM committee"],
            ["basic_payment_received", "admin@club.org", "FALSE", "disabled"],
            ["", "orphan@club.org", "TRUE", "no event — dropped"],
            ["advanced_renewal_received", "", "TRUE", "no recipient — dropped"],
          ],
        },
      });

      const readNotificationRules = await getReadNotificationRules();
      const rules = await readNotificationRules();

      expect(rules).toEqual([
        { event: "advanced_payment_received", recipient_email: "membership@club.org", enabled: "TRUE" },
        { event: "basic_payment_received", recipient_email: "admin@club.org", enabled: "FALSE" },
      ]);
    });

    it("returns an empty array when the tab has no data rows", async () => {
      mockSpreadsheetGet.mockResolvedValueOnce({
        data: { sheets: [{ properties: { title: "Notification Rules" } }] },
      });
      mockGet.mockResolvedValueOnce({ data: { values: null } });

      const readNotificationRules = await getReadNotificationRules();
      expect(await readNotificationRules()).toEqual([]);
    });

    it("does NOT rewrite headers when the tab already exists (preserves admin edits)", async () => {
      mockSpreadsheetGet.mockResolvedValueOnce({
        data: { sheets: [{ properties: { title: "Notification Rules" } }] },
      });
      mockGet.mockResolvedValueOnce({ data: { values: [] } });

      const readNotificationRules = await getReadNotificationRules();
      await readNotificationRules();

      expect(mockBatchUpdate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("creates the tab and writes headers exactly once when missing", async () => {
      // Default mockSpreadsheetGet returns only "Basic Applications" → tab missing.
      mockGet.mockResolvedValueOnce({ data: { values: [] } });

      const readNotificationRules = await getReadNotificationRules();
      await readNotificationRules();

      expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'Notification Rules'!A1:D1",
          requestBody: {
            values: [["event", "recipient_email", "enabled", "description"]],
          },
        }),
      );
    });

    it("swallows the 'already exists' race when two webhooks create the tab", async () => {
      // Tab missing per default spreadsheet.get, but batchUpdate loses the create race.
      mockBatchUpdate.mockRejectedValueOnce(
        new Error("Add sheet failed: A sheet with the name already exists."),
      );
      mockGet.mockResolvedValueOnce({
        data: { values: [["advanced_payment_received", "membership@club.org", "TRUE", ""]] },
      });

      const readNotificationRules = await getReadNotificationRules();
      const rules = await readNotificationRules();

      // Header write skipped (the other webhook wrote it); rows still parsed.
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(rules).toEqual([
        { event: "advanced_payment_received", recipient_email: "membership@club.org", enabled: "TRUE" },
      ]);
    });
  });
});
