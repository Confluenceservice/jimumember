import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockAuthorize, mockAppend, mockUpdate, mockGet, mockBatchUpdate, mockValuesBatchUpdate, mockEnsureSheet } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockAuthorize: vi.fn(),
  mockAppend: vi.fn(),
  mockUpdate: vi.fn(),
  mockGet: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockValuesBatchUpdate: vi.fn(),
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
          values: { append: mockAppend, update: mockUpdate, get: mockGet, batchUpdate: mockValuesBatchUpdate },
          batchUpdate: mockBatchUpdate,
          get: mockEnsureSheet,
        },
      };
    }),
  },
}));

process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";

import {
  columnLetter,
  getSpreadsheetId,
  ensureSheetWithHeaders,
  appendRow,
  appendToRange,
  readRange,
  readDataRows,
  updateRange,
  batchUpdateRanges,
  _resetSheetsClientCacheForTesting,
} from "./google-sheets-helpers";

describe("columnLetter", () => {
  it("maps single-letter columns", () => {
    expect(columnLetter(1)).toBe("A");
    expect(columnLetter(6)).toBe("F");
    expect(columnLetter(16)).toBe("P");
    expect(columnLetter(26)).toBe("Z");
  });

  it("maps double-letter columns past Z", () => {
    expect(columnLetter(27)).toBe("AA");
    expect(columnLetter(28)).toBe("AB");
    expect(columnLetter(47)).toBe("AU"); // upload-sheet.ts's 47-column schema
    expect(columnLetter(52)).toBe("AZ");
    expect(columnLetter(53)).toBe("BA");
  });
});

describe("getSpreadsheetId", () => {
  afterEach(() => {
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";
  });

  it("returns the trimmed env var", () => {
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "  sheet_abc  ";
    expect(getSpreadsheetId()).toBe("sheet_abc");
  });

  it("throws when unset", () => {
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    expect(() => getSpreadsheetId()).toThrow("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  });
});

describe("ensureSheetWithHeaders / appendRow / readRange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSheetsClientCacheForTesting();
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet_test_id";
    mockAuth.mockImplementation(() => ({ authorize: mockAuthorize }));
    mockAuthorize.mockResolvedValue({});
    mockAppend.mockResolvedValue({});
    mockUpdate.mockResolvedValue({});
    mockBatchUpdate.mockResolvedValue({});
    mockValuesBatchUpdate.mockResolvedValue({});
  });

  it("creates a missing tab and writes headers", async () => {
    mockEnsureSheet.mockResolvedValueOnce({ data: { sheets: [] } });

    await ensureSheetWithHeaders("Widgets", ["a", "b", "c"]);

    expect(mockBatchUpdate).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: { requests: [{ addSheet: { properties: { title: "Widgets" } } }] },
    }));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      range: "'Widgets'!A1:C1",
      requestBody: { values: [["a", "b", "c"]] },
    }));
  });

  it("self-heals without rewriting when the header is already correct", async () => {
    mockEnsureSheet.mockResolvedValueOnce({ data: { sheets: [{ properties: { title: "Widgets", sheetId: 1 } }] } });
    mockGet.mockResolvedValueOnce({ data: { values: [["a"]] } });

    await ensureSheetWithHeaders("Widgets", ["a", "b", "c"]);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it("appendRow ensures the tab then appends", async () => {
    mockEnsureSheet.mockResolvedValueOnce({ data: { sheets: [{ properties: { title: "Widgets", sheetId: 1 } }] } });
    mockGet.mockResolvedValueOnce({ data: { values: [["a"]] } });

    await appendRow("Widgets", ["a", "b", "c"], ["1", "2", "3"]);

    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      range: "'Widgets'!A1:C1",
      requestBody: { values: [["1", "2", "3"]] },
    }));
  });

  it("appendToRange appends without any tab management", async () => {
    await appendToRange("A1:I1", ["x", "y"]);

    expect(mockEnsureSheet).not.toHaveBeenCalled();
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      range: "A1:I1",
      requestBody: { values: [["x", "y"]] },
    }));
  });

  it("readRange returns the raw values array", async () => {
    mockGet.mockResolvedValueOnce({ data: { values: [["h1", "h2"], ["v1", "v2"]] } });

    const rows = await readRange("'Widgets'!A:B");

    expect(rows).toEqual([["h1", "h2"], ["v1", "v2"]]);
  });

  it("readRange returns an empty array when the sheet has no data", async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    expect(await readRange("'Widgets'!A:B")).toEqual([]);
  });

  it("readDataRows strips the header row", async () => {
    mockGet.mockResolvedValueOnce({ data: { values: [["h1", "h2"], ["v1", "v2"]] } });

    const rows = await readDataRows("Widgets", ["h1", "h2"]);

    expect(rows).toEqual([["v1", "v2"]]);
  });

  it("updateRange writes a single range", async () => {
    await updateRange("Widgets!C5", [["val"]]);

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      range: "Widgets!C5",
      requestBody: { values: [["val"]] },
    }));
  });

  it("batchUpdateRanges writes multiple ranges in one call", async () => {
    await batchUpdateRanges([
      { range: "Widgets!A1", values: [["1"]] },
      { range: "Widgets!B1", values: [["2"]] },
    ]);

    expect(mockValuesBatchUpdate).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: "Widgets!A1", values: [["1"]] },
          { range: "Widgets!B1", values: [["2"]] },
        ],
      },
    }));
  });
});
