import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks - use inline factories so vi.fn() references are valid (not hoisted)
// ---------------------------------------------------------------------------

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock functions - stored as module-level vars so getMocks() can return them
// ---------------------------------------------------------------------------

const mockSpreadsheetsGet = vi.fn();
const mockSpreadsheetsBatchUpdate = vi.fn();
const mockSpreadsheetsValuesGet = vi.fn();
const mockSpreadsheetsValuesAppend = vi.fn();
const mockSpreadsheetsValuesUpdate = vi.fn();
const mockSpreadsheetsValuesBatchUpdate = vi.fn();

function MockJWT() {}
MockJWT.prototype.authenticate = vi.fn().mockResolvedValue(undefined);
MockJWT.prototype.authorize = vi.fn().mockResolvedValue(undefined);
MockJWT.prototype.getAccessToken = vi.fn().mockResolvedValue("mock_token");
MockJWT.prototype.setCredentials = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      JWT: vi.fn().mockImplementation(MockJWT),
    },
    sheets: vi.fn().mockReturnValue({
      spreadsheets: {
        get: mockSpreadsheetsGet,
        batchUpdate: mockSpreadsheetsBatchUpdate,
        values: {
          get: mockSpreadsheetsValuesGet,
          append: mockSpreadsheetsValuesAppend,
          update: mockSpreadsheetsValuesUpdate,
          batchUpdate: mockSpreadsheetsValuesBatchUpdate,
        },
      },
    }),
  },
}));

// ---------------------------------------------------------------------------
// Accessor for mocks
// ---------------------------------------------------------------------------

function getMocks() {
  return {
    mockSpreadsheetsGet,
    mockSpreadsheetsBatchUpdate,
    mockSpreadsheetsValuesGet,
    mockSpreadsheetsValuesAppend,
    mockSpreadsheetsValuesUpdate,
    mockSpreadsheetsValuesBatchUpdate,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Record<string, string | number> = {}): string[] {
  const defaults: Record<string, string | number> = {
    0: "app_123",
    1: "jane@example.com",
    2: "Jane",
    3: "Doe",
    4: "0271234567",
    5: "1990-01-15",
    6: "European",
    7: "12 Main St",
    8: "PO Box 123",
    9: "Jane Doe EOL",
    10: "https://jd.com",
    11: '[{"name":"Cert","provider":"School"}]',
    12: '[{"role":"EOL Doula","years":3}]',
    13: '{"q1":"yes"}',
    14: "[true,true,true]",
    15: "Ref One",
    16: "Doctor",
    17: "ref1@test.com",
    18: "021123456",
    19: "Ref Two",
    20: "Social Worker",
    21: "ref2@test.com",
    22: "022234567",
    23: "TRUE",
    24: "TRUE",
    25: "TRUE",
    26: "TRUE",
    27: "TRUE",
    28: "TRUE",
    29: "TRUE",
    30: "TRUE",
    31: "2024-05-01T00:00:00Z",
    32: "tok_abc123",
    33: "hashed_email_value",
    34: "1",
    35: "1",
    36: "1",
    37: "1",
    38: "1",
    39: "1",
    40: "0",
    41: "TRUE",
    42: "cs_test_456",
    43: "FALSE",
    44: "2024-05-01T00:00:00Z",
    45: "",
    46: "TRUE", // email_verified
  };
  const row: string[] = new Array(47).fill("");
  for (const [key, val] of Object.entries(defaults)) {
    row[parseInt(key)] = String(val);
  }
  for (const [key, val] of Object.entries(overrides)) {
    row[parseInt(key)] = String(val);
  }
  return row;
}

const HEADER_ROW = "applicant_id email first_name last_name phone date_of_birth ethnicity address postal_address business_name website qualifications experience further_requirements core_competencies referee1_name referee1_role referee1_email referee1_phone referee2_name referee2_role referee2_email referee2_phone declaration_accuracy declaration_ethics declaration_scope declaration_doula_services declaration_interview declaration_professional_dev declaration_criminal_check declaration_meetings declaration_signed_at resume_token email_hash doc_training_count doc_ethics_count doc_criminal_count doc_advance_care_count doc_assisted_dying_count doc_fundamentals_count doc_insurance_count complete stripe_session paid created_at paid_at".split(" ");

function resetSheetData(rows: string[][]) {
  const mocks = getMocks();
  mocks.mockSpreadsheetsValuesGet.mockResolvedValue({ data: { values: rows } });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("upload-sheet", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "spreadsheet_123";
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL = "test@remember.iam.gserviceaccount.com";
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY = "-----BEGIN RSA KEY-----\ntest\n-----END RSA KEY-----\n";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("REQUIRED_DOC_TYPES", () => {
    it("contains 6 required doc types", async () => {
      const { REQUIRED_DOC_TYPES } = await import("./upload-sheet");
      expect(REQUIRED_DOC_TYPES).toEqual([
        "training",
        "ethics",
        "criminal",
        "advance_care",
        "assisted_dying",
        "fundamentals",
      ]);
    });
  });

  describe("OPTIONAL_DOC_TYPES", () => {
    it("contains insurance", async () => {
      const { OPTIONAL_DOC_TYPES } = await import("./upload-sheet");
      expect(OPTIONAL_DOC_TYPES).toEqual(["insurance"]);
    });
  });

  describe("createApplicantRow", () => {
    it("throws when GOOGLE_SHEETS_SPREADSHEET_ID is missing", async () => {
      delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
      const { createApplicantRow } = await import("./upload-sheet");
      await expect(
        createApplicantRow("id", "Jane", "Doe", "0271234567", "jane@example.com", "tok_123")
      ).rejects.toThrow("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
    });

    it("appends a correctly-structured row to the sheet", async () => {
      const mocks = getMocks();
      mocks.mockSpreadsheetsValuesGet.mockResolvedValue({
        data: {
          values: [["applicant_id"]],
        },
      });
      mocks.mockSpreadsheetsValuesAppend.mockResolvedValue({});
      mocks.mockSpreadsheetsGet.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: "Advanced Applications", sheetId: "0" } }],
        },
      });

      const { createApplicantRow } = await import("./upload-sheet");
      await createApplicantRow(
        "app_new", "Jane", "Doe", "0271234567", "jane@example.com", "tok_new",
        "1990-01-15", "European", "12 Main St", "PO Box 123", "Jane Doe EOL",
        "https://jd.com", '[{"name":"Cert"}]', '[{"role":"Doula"}]',
        '{"q1":"yes"}', "[true]",
        "Ref One", "Doctor", "ref1@test.com", "021123456",
        "Ref Two", "Social Worker", "ref2@test.com", "022234567",
        "TRUE", "TRUE", "TRUE", "TRUE", "TRUE", "TRUE", "TRUE", "TRUE",
        "2024-05-01T00:00:00Z"
      );

      expect(mocks.mockSpreadsheetsValuesAppend).toHaveBeenCalled();
      const row = mocks.mockSpreadsheetsValuesAppend.mock.calls[0][0].requestBody.values[0];
      expect(row[0]).toBe("app_new");
      expect(row[2]).toBe("Jane");
      expect(row[32]).toBe("tok_new");
      expect(row[41]).toBe("FALSE"); // complete
      expect(row[43]).toBe("FALSE"); // paid
    });

    it("uses empty string defaults for optional parameters", async () => {
      const mocks = getMocks();
      mocks.mockSpreadsheetsValuesGet.mockResolvedValue({ data: { values: [["applicant_id"]] } });
      mocks.mockSpreadsheetsValuesAppend.mockResolvedValue({});
      mocks.mockSpreadsheetsGet.mockResolvedValue({
        data: { sheets: [{ properties: { title: "Advanced Applications", sheetId: "0" } }] },
      });

      const { createApplicantRow } = await import("./upload-sheet");
      await createApplicantRow("app_min", "Jane", "Doe", "0271234567", "jane@example.com", "tok_min");

      const row = mocks.mockSpreadsheetsValuesAppend.mock.calls[0][0].requestBody.values[0];
      expect(row[5]).toBe("");  // dateOfBirth
      expect(row[6]).toBe("");  // ethnicity
    });
  });

  describe("updateApplicantFormData", () => {
    it("throws when applicant not found", async () => {
      resetSheetData([["applicant_id"], ["other_app"]]);
      const { updateApplicantFormData } = await import("./upload-sheet");
      await expect(updateApplicantFormData("app_missing", { firstName: "Jane" }))
        .rejects.toThrow("Applicant not found: app_missing");
    });

    it("updates multiple columns for the matched applicant", async () => {
      const mocks = getMocks();
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_target", 2: "Old", 4: "0270000000" })]);
      mocks.mockSpreadsheetsValuesBatchUpdate.mockResolvedValue({});

      const { updateApplicantFormData } = await import("./upload-sheet");
      await updateApplicantFormData("app_target", { firstName: "New", phone: "0211111111" });

      expect(mocks.mockSpreadsheetsValuesBatchUpdate).toHaveBeenCalled();
      const data = mocks.mockSpreadsheetsValuesBatchUpdate.mock.calls[0][0].requestBody.data;
      const ranges = data.map((d: { range: string }) => d.range);
      expect(ranges).toContain("Advanced Applications!C2"); // first_name
      expect(ranges).toContain("Advanced Applications!E2"); // phone
    });

    it("skips empty values (no update sent for empty firstName)", async () => {
      const mocks = getMocks();
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_skip" })]);
      mocks.mockSpreadsheetsValuesBatchUpdate.mockResolvedValue({});

      const { updateApplicantFormData } = await import("./upload-sheet");
      await updateApplicantFormData("app_skip", { firstName: "" });

      expect(mocks.mockSpreadsheetsValuesBatchUpdate).not.toHaveBeenCalled();
    });
  });

  describe("updateDocCount", () => {
    it("throws when applicant not found", async () => {
      resetSheetData([["applicant_id"], ["other_app"]]);
      const { updateDocCount } = await import("./upload-sheet");
      await expect(updateDocCount("app_missing", "training", 2))
        .rejects.toThrow("Applicant not found: app_missing");
    });

    it("updates column AI for training doc type", async () => {
      const mocks = getMocks();
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_docs" })]);
      mocks.mockSpreadsheetsValuesUpdate.mockResolvedValue({});

      const { updateDocCount } = await import("./upload-sheet");
      await updateDocCount("app_docs", "training", 3);

      expect(mocks.mockSpreadsheetsValuesUpdate).toHaveBeenCalled();
      const call = mocks.mockSpreadsheetsValuesUpdate.mock.calls[0][0];
      expect(call.range).toContain("AI");
      expect(call.requestBody.values).toEqual([[3]]);
    });

    it("updates column AJ for ethics doc type", async () => {
      const mocks = getMocks();
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_ethics" })]);
      mocks.mockSpreadsheetsValuesUpdate.mockResolvedValue({});

      const { updateDocCount } = await import("./upload-sheet");
      await updateDocCount("app_ethics", "ethics", 2);

      const call = mocks.mockSpreadsheetsValuesUpdate.mock.calls[0][0];
      expect(call.range).toContain("AJ");
    });

    it("does nothing for unknown doc types", async () => {
      const mocks = getMocks();
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_known" })]);
      mocks.mockSpreadsheetsValuesUpdate.mockResolvedValue({});

      const { updateDocCount } = await import("./upload-sheet");
      await updateDocCount("app_known", "unknown_type", 5);

      expect(mocks.mockSpreadsheetsValuesUpdate).not.toHaveBeenCalled();
    });
  });

  describe("markComplete", () => {
    it("throws when applicant not found", async () => {
      resetSheetData([["applicant_id"], ["other_app"]]);
      const { markComplete } = await import("./upload-sheet");
      await expect(markComplete("app_missing", "cs_123"))
        .rejects.toThrow("Applicant not found: app_missing");
    });

    it("sets complete=TRUE and stripe_session in columns AP and AQ", async () => {
      const mocks = getMocks();
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_complete" })]);
      mocks.mockSpreadsheetsValuesUpdate.mockResolvedValue({});

      const { markComplete } = await import("./upload-sheet");
      await markComplete("app_complete", "cs_complete_123");

      expect(mocks.mockSpreadsheetsValuesUpdate).toHaveBeenCalled();
      const call = mocks.mockSpreadsheetsValuesUpdate.mock.calls[0][0];
      expect(call.range).toBe("Advanced Applications!AP2:AQ2");
      expect(call.requestBody.values).toEqual([["TRUE", "cs_complete_123"]]);
    });
  });

  describe("markPaid", () => {
    it("throws when applicant not found", async () => {
      resetSheetData([["applicant_id"], ["other_app"]]);
      const { markPaid } = await import("./upload-sheet");
      await expect(markPaid("app_missing")).rejects.toThrow("Applicant not found: app_missing");
    });

    it("updates paid=TRUE in column AR and paid_at in column AT", async () => {
      const mocks = getMocks();
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_paid" })]);
      mocks.mockSpreadsheetsValuesBatchUpdate.mockResolvedValue({});

      const { markPaid } = await import("./upload-sheet");
      await markPaid("app_paid");

      expect(mocks.mockSpreadsheetsValuesBatchUpdate).toHaveBeenCalled();
      const data = mocks.mockSpreadsheetsValuesBatchUpdate.mock.calls[0][0].requestBody.data;
      const ranges = data.map((d: { range: string }) => d.range);
      expect(ranges).toContain("Advanced Applications!AR2");
      expect(ranges).toContain("Advanced Applications!AT2");
    });
  });

  describe("getApplicantByToken", () => {
    it("returns null when no rows match", async () => {
      resetSheetData([HEADER_ROW, makeRow({ 32: "tok_other" })]);
      const { getApplicantByToken } = await import("./upload-sheet");
      const result = await getApplicantByToken("tok_nonexistent");
      expect(result).toBeNull();
    });

    it("returns the matching applicant by resume_token", async () => {
      resetSheetData([
        HEADER_ROW,
        makeRow({ 0: "app_token_match", 32: "tok_target", 2: "Target", 3: "Applicant" }),
      ]);
      const { getApplicantByToken } = await import("./upload-sheet");
      const result = await getApplicantByToken("tok_target");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("app_token_match");
      expect(result!.firstName).toBe("Target");
    });

    it("normalizes complete and paid to uppercase TRUE/FALSE", async () => {
      resetSheetData([
        HEADER_ROW,
        makeRow({ 0: "app_norm", 41: "true", 43: "true" }),
      ]);
      const { getApplicantByToken } = await import("./upload-sheet");
      const result = await getApplicantByToken("tok_abc123");
      expect(result!.complete).toBe("TRUE");
      expect(result!.paid).toBe("TRUE");
    });
  });

  describe("getApplicantByEmail", () => {
    it("matches email case-insensitively", async () => {
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_email", 1: "JANE@EXAMPLE.COM" })]);
      const { getApplicantByEmail } = await import("./upload-sheet");
      const result = await getApplicantByEmail("jane@example.com");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("app_email");
    });

    it("returns null when no email matches", async () => {
      resetSheetData([HEADER_ROW, makeRow({ 1: "other@example.com" })]);
      const { getApplicantByEmail } = await import("./upload-sheet");
      const result = await getApplicantByEmail("notfound@example.com");
      expect(result).toBeNull();
    });
  });

  describe("getUploadStatus", () => {
    it("returns null when applicant not found", async () => {
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_other" })]);
      const { getUploadStatus } = await import("./upload-sheet");
      const result = await getUploadStatus("app_missing");
      expect(result).toBeNull();
    });

    it("returns UploadStatus with doc counts and flags", async () => {
      resetSheetData([
        HEADER_ROW,
        makeRow({
          0: "app_upload", 2: "Up", 3: "Loader", 4: "0271111",
          1: "up@example.com", 33: "hash123",
          34: "2", 35: "1", 36: "0", 37: "3", 38: "1", 39: "2", 40: "0",
          41: "FALSE", 42: "cs_up", 43: "FALSE", 44: "2024-05-01T00:00:00Z",
        }),
      ]);
      const { getUploadStatus } = await import("./upload-sheet");
      const result = await getUploadStatus("app_upload");
      expect(result).not.toBeNull();
      expect(result!.applicantId).toBe("app_upload");
      expect(result!.docs.training).toBe(2);
      expect(result!.docs.criminal).toBe(0);
      expect(result!.complete).toBe(false);
      expect(result!.paid).toBe(false);
    });
  });

  describe("getApplicantById", () => {
    it("returns null when applicant not found", async () => {
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_other" })]);
      const { getApplicantById } = await import("./upload-sheet");
      const result = await getApplicantById("app_missing");
      expect(result).toBeNull();
    });

    it("returns the matching applicant by id", async () => {
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_by_id", 2: "By", 3: "ID" })]);
      const { getApplicantById } = await import("./upload-sheet");
      const result = await getApplicantById("app_by_id");
      expect(result).not.toBeNull();
      expect(result!.firstName).toBe("By");
    });
  });

  describe("email_verified (column AU)", () => {
    it("getApplicantByToken returns emailVerified TRUE when AU is TRUE", async () => {
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_v", 46: "TRUE" })]);
      const { getApplicantByToken } = await import("./upload-sheet");
      const result = await getApplicantByToken("tok_abc123");
      expect(result!.emailVerified).toBe("TRUE");
    });

    it("getApplicantByToken returns emailVerified FALSE when AU is FALSE", async () => {
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_v_false", 46: "FALSE" })]);
      const { getApplicantByToken } = await import("./upload-sheet");
      const result = await getApplicantByToken("tok_abc123");
      expect(result!.emailVerified).toBe("FALSE");
    });

    it("getApplicantByToken treats legacy blank AU as verified (TRUE)", async () => {
      // Pass "" to override the default "TRUE" set by makeRow, simulating a
      // pre-AU row that was never written by the new code path.
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_legacy", 46: "" })]);
      const { getApplicantByToken } = await import("./upload-sheet");
      const result = await getApplicantByToken("tok_abc123");
      expect(result!.emailVerified).toBe("TRUE");
    });

    it("getApplicantByEmail reads emailVerified the same way", async () => {
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_ev", 46: "FALSE" })]);
      const { getApplicantByEmail } = await import("./upload-sheet");
      const result = await getApplicantByEmail("jane@example.com");
      expect(result!.emailVerified).toBe("FALSE");
    });

    it("getApplicantById reads emailVerified the same way", async () => {
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_id_ev", 46: "FALSE" })]);
      const { getApplicantById } = await import("./upload-sheet");
      const result = await getApplicantById("app_id_ev");
      expect(result!.emailVerified).toBe("FALSE");
    });

    it("createApplicantRow writes FALSE to AU by default (new rows unverified)", async () => {
      const mocks = getMocks();
      mocks.mockSpreadsheetsValuesGet.mockResolvedValue({
        data: { values: [["applicant_id"]] },
      });
      mocks.mockSpreadsheetsValuesAppend.mockResolvedValue({});
      mocks.mockSpreadsheetsGet.mockResolvedValue({
        data: { sheets: [{ properties: { title: "Advanced Applications", sheetId: "0" } }] },
      });

      const { createApplicantRow } = await import("./upload-sheet");
      await createApplicantRow("app_new", "Jane", "Doe", "0271234567", "jane@example.com", "tok_new");

      const row = mocks.mockSpreadsheetsValuesAppend.mock.calls[0][0].requestBody.values[0];
      expect(row[46]).toBe("FALSE");
    });

    it("markEmailVerified writes TRUE to column AU{rowIndex}", async () => {
      const mocks = getMocks();
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_mark", 46: "FALSE" })]);
      mocks.mockSpreadsheetsValuesUpdate.mockResolvedValue({});

      const { markEmailVerified } = await import("./upload-sheet");
      await markEmailVerified("app_mark");

      expect(mocks.mockSpreadsheetsValuesUpdate).toHaveBeenCalled();
      const call = mocks.mockSpreadsheetsValuesUpdate.mock.calls[0][0];
      expect(call.range).toContain("AU2");
      expect(call.requestBody.values).toEqual([["TRUE"]]);
    });

    it("markEmailVerified throws when applicant not found", async () => {
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_other" })]);
      const { markEmailVerified } = await import("./upload-sheet");
      await expect(markEmailVerified("app_missing"))
        .rejects.toThrow("Applicant not found: app_missing");
    });
  });

  describe("validateCompletion", () => {
    it("returns false when applicant not found", async () => {
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_other" })]);
      const { validateCompletion } = await import("./upload-sheet");
      const result = await validateCompletion("app_missing");
      expect(result).toBe(false);
    });

    it("returns false when a required doc count is zero", async () => {
      resetSheetData([
        HEADER_ROW,
        makeRow({
          0: "app_incomplete", 34: "1", 35: "1", 36: "0", 37: "1", 38: "1", 39: "1",
          23: "TRUE", 24: "TRUE", 25: "TRUE", 26: "TRUE", 27: "TRUE", 28: "TRUE", 29: "TRUE", 30: "TRUE",
        }),
      ]);
      const { validateCompletion } = await import("./upload-sheet");
      const result = await validateCompletion("app_incomplete");
      expect(result).toBe(false);
    });

    it("returns false when a declaration is not TRUE", async () => {
      resetSheetData([
        HEADER_ROW,
        makeRow({
          0: "app_decl", 34: "1", 35: "1", 36: "1", 37: "1", 38: "1", 39: "1",
          23: "TRUE", 24: "TRUE", 25: "FALSE", 26: "TRUE", 27: "TRUE", 28: "TRUE", 29: "TRUE", 30: "TRUE",
        }),
      ]);
      const { validateCompletion } = await import("./upload-sheet");
      const result = await validateCompletion("app_decl");
      expect(result).toBe(false);
    });

    it("returns true when form is complete and all required docs present", async () => {
      resetSheetData([
        HEADER_ROW,
        makeRow({
          0: "app_valid", 2: "Valid", 3: "Applicant", 4: "0271234567",
          1: "valid@example.com", 5: "1990-01-01", 6: "European",
          7: "12 Main St", 8: "PO Box 123", 9: "Valid EOL", 10: "https://valid.com",
          11: '[{"name":"Course"}]', 12: '[{"role":"Doula","years":2}]',
          13: "{}", 14: "[true]",
          15: "Ref One", 16: "Role", 17: "ref1@test.com", 18: "021111111",
          19: "Ref Two", 20: "Role2", 21: "ref2@test.com", 22: "022222222",
          34: "1", 35: "1", 36: "1", 37: "1", 38: "1", 39: "1",
          23: "TRUE", 24: "TRUE", 25: "TRUE", 26: "TRUE", 27: "TRUE", 28: "TRUE", 29: "TRUE", 30: "TRUE",
        }),
      ]);
      const { validateCompletion } = await import("./upload-sheet");
      const result = await validateCompletion("app_valid");
      expect(result).toBe(true);
    });
  });

  describe("markApplicantPaid", () => {
    it("calls markComplete then markPaid via batch update", async () => {
      const mocks = getMocks();
      resetSheetData([HEADER_ROW, makeRow({ 0: "app_markpaid" })]);
      mocks.mockSpreadsheetsValuesUpdate.mockResolvedValue({});
      mocks.mockSpreadsheetsValuesBatchUpdate.mockResolvedValue({});

      const { markApplicantPaid } = await import("./upload-sheet");
      await markApplicantPaid("app_markpaid", "cs_paid_789");

      expect(mocks.mockSpreadsheetsValuesUpdate).toHaveBeenCalled(); // markComplete
      expect(mocks.mockSpreadsheetsValuesBatchUpdate).toHaveBeenCalled(); // markPaid
    });
  });
});