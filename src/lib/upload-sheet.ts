import { google } from "googleapis";
import crypto from "node:crypto";

export const REQUIRED_DOC_TYPES = [
  "application",
  "training",
  "ethics",
  "criminal",
  "advance_care",
  "assisted_dying",
  "fundamentals",
] as const;

export type DocType = (typeof REQUIRED_DOC_TYPES)[number];

export interface UploadStatus {
  applicantId: string;
  fullName: string;
  emailHash: string;
  docs: Partial<Record<DocType, string>>;
  complete: boolean;
  stripeSessionId?: string;
  paid: boolean;
  createdAt: string;
  paidAt?: string;
}

function getSheetsClient() {
  const email = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim();
  const keyRaw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY?.trim();

  if (!email || !keyRaw) {
    throw new Error("Missing GOOGLE_SHEETS service account config.");
  }

  const key = keyRaw.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

const SHEET_NAME = "Professional Applications";

const SHEET_HEADERS = [
  "applicant_id",
  "email",
  "full_name",
  "resume_token",
  "email_hash",
  "doc_application",
  "doc_training",
  "doc_ethics",
  "doc_criminal",
  "doc_advance_care",
  "doc_assisted_dying",
  "doc_fundamentals",
  "complete",
  "stripe_session",
  "paid",
  "created_at",
  "paid_at",
];

async function ensureSheetExists(sheets: ReturnType<typeof google.sheets>): Promise<string> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  // Check if sheet already exists
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheet = spreadsheet.data.sheets?.find(
    (s) => s.properties?.title === SHEET_NAME
  );

  if (existingSheet) {
    return existingSheet.properties?.sheetId?.toString() || "0";
  }

  // Create the sheet
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: SHEET_NAME,
            },
          },
        },
      ],
    },
  });

  // Add headers
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:O1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [SHEET_HEADERS],
    },
  });

  return "0";
}

function hashEmail(email: string): string {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

export async function createApplicantRow(
  applicantId: string,
  fullName: string,
  email: string,
  resumeToken: string
): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  const sheets = getSheetsClient();

  // Ensure sheet exists (creates if missing)
  await ensureSheetExists(sheets);

  const emailHash = hashEmail(email);

  const row = [
    applicantId,
    email,
    fullName,
    resumeToken,
    emailHash,
    "", // doc_application
    "", // doc_training
    "", // doc_ethics
    "", // doc_criminal
    "", // doc_advance_care
    "", // doc_assisted_dying
    "", // doc_fundamentals
    "FALSE", // complete
    "", // stripe_session
    "FALSE", // paid
    new Date().toISOString(), // created_at
    "", // paid_at
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:P`,
    valueInputOption: "RAW",
    requestBody: {
      values: [row],
    },
  });
}

export async function updateDocUpload(
  applicantId: string,
  docType: DocType
): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  const sheets = getSheetsClient();
  const timestamp = new Date().toISOString();

  // Find the row by applicant_id
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:A`,
  });

  const rows = result.data.values || [];
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === applicantId) {
      rowIndex = i + 1; // 1-indexed for A1 notation
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error(`Applicant not found: ${applicantId}`);
  }

  // Map docType to column index
  const docColumnMap: Record<DocType, string> = {
    application: "D",
    training: "E",
    ethics: "F",
    criminal: "G",
    advance_care: "H",
    assisted_dying: "I",
    fundamentals: "J",
  };

  const column = docColumnMap[docType];
  const range = `${SHEET_NAME}!${column}${rowIndex}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: {
      values: [[timestamp]],
    },
  });
}

export async function markComplete(
  applicantId: string,
  stripeSessionId: string
): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  const sheets = getSheetsClient();

  // Find the row by applicant_id
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:A`,
  });

  const rows = result.data.values || [];
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === applicantId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error(`Applicant not found: ${applicantId}`);
  }

  // Update columns K (complete) and L (stripe_session)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `SHEET_NAME!K${rowIndex}:L${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [["TRUE", stripeSessionId]],
    },
  });
}

export async function markPaid(applicantId: string): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  const sheets = getSheetsClient();

  // Find the row by applicant_id
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:A`,
  });

  const rows = result.data.values || [];
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === applicantId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error(`Applicant not found: ${applicantId}`);
  }

  // Update columns M (paid) and N (paid_at)
  const paidAt = new Date().toISOString();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `SHEET_NAME!M${rowIndex}:N${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [["TRUE", paidAt]],
    },
  });
}

export async function getUploadStatus(
  applicantId: string
): Promise<UploadStatus | null> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  const sheets = getSheetsClient();

  // Find the row by applicant_id
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:P`,
  });

  const rows = result.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === applicantId) {
      const docs: Partial<Record<DocType, string>> = {};
      if (row[5]) docs.application = row[5];
      if (row[6]) docs.training = row[6];
      if (row[7]) docs.ethics = row[7];
      if (row[8]) docs.criminal = row[8];
      if (row[9]) docs.advance_care = row[9];
      if (row[10]) docs.assisted_dying = row[10];
      if (row[11]) docs.fundamentals = row[11];

      const complete =
        REQUIRED_DOC_TYPES.every((type) => docs[type]) || row[12] === "TRUE";

      return {
        applicantId: row[0],
        fullName: row[2],
        emailHash: row[4],
        docs,
        complete,
        stripeSessionId: row[13] || undefined,
        paid: row[14] === "TRUE",
        createdAt: row[15],
        paidAt: row[16] || undefined,
      };
    }
  }

  return null;
}

export interface ApplicantInfo {
  id: string;
  email: string;
  fullName: string;
  resumeToken: string;
  createdAt: string;
  paid: boolean;
}

export async function getApplicantByToken(
  token: string
): Promise<ApplicantInfo | null> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  const sheets = getSheetsClient();

  // Find the row by resume_token
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:P`,
  });

  const rows = result.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[3] === token) {
      return {
        id: row[0],
        email: row[1],
        fullName: row[2],
        resumeToken: row[3],
        createdAt: row[15],
        paid: row[14] === "TRUE",
      };
    }
  }

  return null;
}

export async function getApplicantByEmail(
  email: string
): Promise<ApplicantInfo | null> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  const sheets = getSheetsClient();

  // Find the row by email
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:P`,
  });

  const rows = result.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[1]?.toLowerCase() === email.toLowerCase()) {
      return {
        id: row[0],
        email: row[1],
        fullName: row[2],
        resumeToken: row[3],
        createdAt: row[15],
        paid: row[14] === "TRUE",
      };
    }
  }

  return null;
}

export async function markApplicantPaid(
  applicantId: string,
  stripeSessionId: string
): Promise<void> {
  await markComplete(applicantId, stripeSessionId);
  await markPaid(applicantId);
}