import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockAuthorize, mockAppend, mockUpdate, mockGet, mockBatchUpdate, mockEnsureSheet } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockAuthorize: vi.fn(),
  mockAppend: vi.fn(),
  mockUpdate: vi.fn(),
  mockGet: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockEnsureSheet: vi.fn(),
}));

vi.mock("./google-auth", () => ({
  getServiceAccountJwtAuth: mockAuth.mockImplementation(() => ({
    authorize: mockAuthorize,
  })),
}));

vi.mock("googleapis", () => ({
  google: {
    sheets: vi.fn(function () {
      return {
        spreadsheets: {
          values: { append: mockAppend, update: mockUpdate, get: mockGet },
          batchUpdate: mockBatchUpdate,
          get: mockEnsureSheet,
        },
      };
    }),
  },
}));

process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";

import { appendFeedback, readFeedback, _resetSheetsClientCacheForTesting } from "./feedback-sheet";

describe("appendFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSheetsClientCacheForTesting();
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";
    mockAuth.mockImplementation(() => ({ authorize: mockAuthorize }));
    mockAuthorize.mockResolvedValue({});
    mockAppend.mockResolvedValue({});
    mockEnsureSheet.mockResolvedValue({ data: { sheets: [{ properties: { title: "Feedback", sheetId: 123 } }] } });
    // header check (A1:A1) sees header present → heal path skipped
    mockGet.mockResolvedValue({ data: { values: [["timestamp"]] } });
  });

  afterEach(() => {
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  });

  it("appends a row with all 6 columns in correct order", async () => {
    await appendFeedback({
      timestamp: "2026-07-01T00:00:00.000Z",
      type: "inline",
      page: "/advanced/apply (Step 3 of 8)",
      reaction: "2",
      comment: "Confusing dates",
      answers: {},
    });

    expect(mockAppend).toHaveBeenCalledTimes(1);
    const call = mockAppend.mock.calls[0][0];
    expect(call.range).toBe("'Feedback'!A1:F1");
    expect(call.requestBody.values[0]).toHaveLength(6);
    expect(call.requestBody.values[0]).toEqual([
      "2026-07-01T00:00:00.000Z",
      "inline",
      "/advanced/apply (Step 3 of 8)",
      "2",
      "Confusing dates",
      "{}",
    ]);
  });

  it("serializes answers as JSON for post_submission feedback", async () => {
    await appendFeedback({
      timestamp: "2026-07-01T00:00:00.000Z",
      type: "post_submission",
      page: "advanced_success_upload",
      answers: { clarity: "Yes", ease: "Easy", payment: "Smooth" },
    });

    const call = mockAppend.mock.calls[0][0];
    expect(call.requestBody.values[0][5]).toBe(JSON.stringify({ clarity: "Yes", ease: "Easy", payment: "Smooth" }));
    expect(call.requestBody.values[0][3]).toBe(""); // reaction blank
    expect(call.requestBody.values[0][4]).toBe(""); // comment blank
  });

  it("creates the Feedback tab with headers on first write", async () => {
    mockEnsureSheet.mockResolvedValueOnce({ data: { sheets: [] } });

    await appendFeedback({
      timestamp: "2026-07-01T00:00:00.000Z",
      type: "inline",
      page: "/apply",
    });

    expect(mockBatchUpdate).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: { requests: [{ addSheet: { properties: { title: "Feedback" } } }] },
    }));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      range: "'Feedback'!A1:F1",
      requestBody: { values: [["timestamp", "type", "page", "reaction", "comment", "answers"]] },
    }));
  });

  it("throws when GOOGLE_SHEETS_SPREADSHEET_ID is missing", async () => {
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    await expect(appendFeedback({
      timestamp: "2026-07-01T00:00:00.000Z",
      type: "inline",
      page: "/apply",
    })).rejects.toThrow("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  });
});

describe("readFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSheetsClientCacheForTesting();
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";
    mockAuth.mockImplementation(() => ({ authorize: mockAuthorize }));
    mockAuthorize.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  });

  it("parses rows and JSON answers, skipping the header row", async () => {
    mockGet.mockResolvedValue({
      data: {
        values: [
          ["timestamp", "type", "page", "reaction", "comment", "answers"],
          ["2026-07-01T00:00:00.000Z", "inline", "/apply", "3", "Great", "{}"],
          ["2026-07-01T01:00:00.000Z", "post_submission", "associate_membership", "", "", "{\"clarity\":\"Yes\"}"],
        ],
      },
    });

    const rows = await readFeedback();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      timestamp: "2026-07-01T00:00:00.000Z",
      type: "inline",
      page: "/apply",
      reaction: "3",
      comment: "Great",
      answers: {},
    });
    expect(rows[1].answers).toEqual({ clarity: "Yes" });
  });

  it("returns an empty array when the sheet has no data rows", async () => {
    mockGet.mockResolvedValue({ data: { values: [["timestamp", "type", "page", "reaction", "comment", "answers"]] } });
    const rows = await readFeedback();
    expect(rows).toEqual([]);
  });

  it("falls back to an empty answers object on malformed JSON", async () => {
    mockGet.mockResolvedValue({
      data: {
        values: [
          ["timestamp", "type", "page", "reaction", "comment", "answers"],
          ["2026-07-01T00:00:00.000Z", "inline", "/apply", "1", "", "not json"],
        ],
      },
    });
    const rows = await readFeedback();
    expect(rows[0].answers).toEqual({});
  });
});
