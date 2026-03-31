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
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
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
  "first_name",
  "last_name",
  "phone",
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
    range: `${SHEET_NAME}!A1:S1`,
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
  firstName: string,
  lastName: string,
  phone: string,
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
    firstName,
    lastName,
    phone,
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
    range: `${SHEET_NAME}!A:S`,
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

  // Map docType to column letter (A=1, H=8 where doc_application now lives after header restructure)
  const docColumnMap: Record<DocType, string> = {
    application: "H",
    training: "I",
    ethics: "J",
    criminal: "K",
    advance_care: "L",
    assisted_dying: "M",
    fundamentals: "N",
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

  // Update columns O (complete) and P (stripe_session)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!O${rowIndex}:P${rowIndex}`,
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

  // Update columns Q (paid) and R (paid_at)
  const paidAt = new Date().toISOString();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!Q${rowIndex}:R${rowIndex}`,
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
    range: `${SHEET_NAME}!A:S`,
  });

  const rows = result.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === applicantId) {
      const docs: Partial<Record<DocType, string>> = {};
      if (row[7]) docs.application = row[7];
      if (row[8]) docs.training = row[8];
      if (row[9]) docs.ethics = row[9];
      if (row[10]) docs.criminal = row[10];
      if (row[11]) docs.advance_care = row[11];
      if (row[12]) docs.assisted_dying = row[12];
      if (row[13]) docs.fundamentals = row[13];

      const complete =
        REQUIRED_DOC_TYPES.every((type) => docs[type]) || row[14] === "TRUE";

      return {
        applicantId: row[0],
        firstName: row[2],
        lastName: row[3],
        phone: row[4],
        email: row[1],
        emailHash: row[6],
        docs,
        complete,
        stripeSessionId: row[15] || undefined,
        paid: row[16] === "TRUE",
        createdAt: row[17],
        paidAt: row[18] || undefined,
      };
    }
  }

  return null;
}

export interface ApplicantInfo {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
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

  // Ensure sheet exists before reading
  await ensureSheetExists(sheets);

  // Find the row by resume_token
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:S`,
  });

  const rows = result.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[5] === token) {
      return {
        id: row[0],
        email: row[1],
        firstName: row[2],
        lastName: row[3],
        phone: row[4],
        resumeToken: row[5],
        createdAt: row[17],
        paid: row[16] === "TRUE",
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

  // Ensure sheet exists before reading
  await ensureSheetExists(sheets);

  // Find the row by email
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:S`,
  });

  const rows = result.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[1]?.toLowerCase() === email.toLowerCase()) {
      return {
        id: row[0],
        email: row[1],
        firstName: row[2],
        lastName: row[3],
        phone: row[4],
        resumeToken: row[5],
        createdAt: row[17],
        paid: row[16] === "TRUE",
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