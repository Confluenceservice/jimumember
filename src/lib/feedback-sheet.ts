import {
  appendRow,
  readDataRows,
  _resetSheetsClientCacheForTesting,
} from "./google-sheets-helpers";

export interface FeedbackInput {
  timestamp: string;
  type: "inline" | "post_submission";
  page: string;
  reaction?: string;
  comment?: string;
  answers?: Record<string, string>;
}

export interface FeedbackRow {
  timestamp: string;
  type: string;
  page: string;
  reaction: string;
  comment: string;
  answers: Record<string, string>;
}

const FEEDBACK_HEADERS = [
  "timestamp", "type", "page", "reaction", "comment", "answers",
] as const;

const SHEET_NAME = "Feedback";

export { _resetSheetsClientCacheForTesting };

export async function appendFeedback(input: FeedbackInput): Promise<void> {
  const row = [
    input.timestamp,
    input.type,
    input.page,
    input.reaction ?? "",
    input.comment ?? "",
    JSON.stringify(input.answers ?? {}),
  ];

  await appendRow(SHEET_NAME, FEEDBACK_HEADERS, row);
}

export async function readFeedback(): Promise<FeedbackRow[]> {
  const dataRows = await readDataRows(SHEET_NAME, FEEDBACK_HEADERS);

  return dataRows.map((r) => {
    let answers: Record<string, string> = {};
    try { answers = JSON.parse(r[5] ?? "{}"); } catch { answers = {}; }
    return {
      timestamp: r[0] ?? "",
      type: r[1] ?? "",
      page: r[2] ?? "",
      reaction: r[3] ?? "",
      comment: r[4] ?? "",
      answers,
    };
  });
}
