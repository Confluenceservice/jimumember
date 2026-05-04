import { google } from "googleapis";
import type { DocType } from "./upload-sheet";

const DRIVE_FILES_SHEET = "Drive Files";

const DRIVE_FILES_HEADERS = [
  "file_id",        // A
  "applicant_id",   // B
  "doc_type",       // C
  "original_filename", // D
  "uploaded_at",    // E
  "deleted",       // F
];

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

function getDriveClient() {
  const email = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim();
  const keyRaw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY?.trim();

  if (!email || !keyRaw) {
    throw new Error("Missing GOOGLE_SHEETS service account config.");
  }

  const key = keyRaw.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({ version: "v3", auth });
}

async function ensureDriveFilesSheetExists(sheets: ReturnType<typeof google.sheets>): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheet = spreadsheet.data.sheets?.find(
    (s) => s.properties?.title === DRIVE_FILES_SHEET
  );

  if (existingSheet) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: DRIVE_FILES_SHEET } } }],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${DRIVE_FILES_SHEET}'!A1:F1`,
    valueInputOption: "RAW",
    requestBody: { values: [DRIVE_FILES_HEADERS] },
  });
}

export interface DriveFileRecord {
  fileId: string;
  applicantId: string;
  docType: string;
  originalFilename: string;
  uploadedAt: string;
  deleted: boolean;
}

export async function addDriveFile(
  applicantId: string,
  docType: string,
  originalFilename: string,
  fileId: string
): Promise<void> {
  const sheets = getSheetsClient();
  await ensureDriveFilesSheetExists(sheets);

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${DRIVE_FILES_SHEET}'!A:F`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        fileId,
        applicantId,
        docType,
        originalFilename,
        new Date().toISOString(),
        "FALSE",
      ]],
    },
  });
}

export async function softDeleteDriveFile(fileId: string): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${DRIVE_FILES_SHEET}'!A:A`,
  });

  const rows = result.data.values || [];
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === fileId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${DRIVE_FILES_SHEET}'!F${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [["TRUE"]] },
  });

  // Trash the actual Drive file
  const drive = getDriveClient();
  try {
    await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });
  } catch {
    // File may already be missing; don't fail
  }
}

export async function listDriveFiles(applicantId: string): Promise<DriveFileRecord[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${DRIVE_FILES_SHEET}'!A:F`,
  });

  const rows = result.data.values || [];
  const files: DriveFileRecord[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[1] === applicantId && row[5] !== "TRUE") {
      files.push({
        fileId: row[0] ?? "",
        applicantId: row[1] ?? "",
        docType: row[2] ?? "",
        originalFilename: row[3] ?? "",
        uploadedAt: row[4] ?? "",
        deleted: row[5] === "TRUE",
      });
    }
  }

  return files;
}

export async function getDriveFilesForDocType(
  applicantId: string,
  docType: string
): Promise<DriveFileRecord[]> {
  const all = await listDriveFiles(applicantId);
  return all.filter((f) => f.docType === docType);
}

export async function getDriveFileCounts(
  applicantId: string
): Promise<Partial<Record<DocType, number>>> {
  const files = await listDriveFiles(applicantId);
  const counts: Partial<Record<DocType, number>> = {};

  for (const file of files) {
    const docType = file.docType as DocType;
    counts[docType] = (counts[docType] || 0) + 1;
  }

  return counts;
}