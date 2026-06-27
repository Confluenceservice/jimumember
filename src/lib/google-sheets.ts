import { google } from "googleapis";
import { getServiceAccountJwtAuth } from "./google-auth";

type CheckoutLogEntry = {
  timestamp: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  plan: string;
  amountPaid: number;
  sessionId: string;
  customerId: string;
};
type AssociateApplicationEntry = {
  submittedAt: string;
  applicationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  fullAddress: string;
  postalAddress: string;
  businessName: string;
  interestJoining: string;
  trainingDetails: string;
  listOnPage: string;
  listingDetails: string;
  signature: string;
  applicationDate: string;
  checkoutStatus: string;
};

const BASIC_APPLICATIONS_SHEET = "Basic Applications";
const EMAIL_LOG_SHEET = "Email log";
const ASSOCIATE_APPLICATIONS_HEADERS = [
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
] as const;

function getSheetsClient() {
  const auth = getServiceAccountJwtAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  return google.sheets({ version: "v4", auth });
}

async function ensureSheetWithHeaders(
  sheetName: string,
  headers: readonly string[],
): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  const sheets = getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const hasSheet = spreadsheet.data.sheets?.some(
    (sheet) => sheet.properties?.title === sheetName,
  );

  if (!hasSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      },
    });
  }

  const headerRangeEnd = String.fromCharCode(64 + headers.length);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A1:${headerRangeEnd}1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [Array.from(headers)],
    },
  });
}

export async function appendCheckoutLog(entry: CheckoutLogEntry): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  const sheets = getSheetsClient();

  const amountDisplay = `NZ$${(entry.amountPaid / 100).toFixed(2)}`;

  const row = [
    entry.timestamp,
    entry.firstName,
    entry.lastName,
    entry.phone,
    entry.email,
    entry.plan,
    amountDisplay,
    entry.sessionId,
    entry.customerId,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "A1:I1",
    valueInputOption: "RAW",
    requestBody: {
      values: [row],
    },
  });
}

type EmailLogEntry = {
  timestamp: string;
  to: string;
  subject: string;
  template: string;
  applicantId?: string;
  result: "sent" | "failed";
  error?: string;
};

export async function appendEmailLog(entry: EmailLogEntry): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  const sheets = getSheetsClient();

  const row = [
    entry.timestamp,
    entry.to,
    entry.subject,
    entry.template,
    entry.applicantId ?? "",
    entry.result,
    entry.error ?? "",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${EMAIL_LOG_SHEET}'!A1:G1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [row],
    },
  });
}

export async function appendBasicApplication(
  entry: AssociateApplicationEntry,
): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  }

  await ensureSheetWithHeaders(
    BASIC_APPLICATIONS_SHEET,
    ASSOCIATE_APPLICATIONS_HEADERS,
  );

  const sheets = getSheetsClient();
  const row = [
    entry.submittedAt,
    entry.applicationId,
    entry.firstName,
    entry.lastName,
    entry.email,
    entry.phone,
    entry.fullAddress,
    entry.postalAddress,
    entry.businessName,
    entry.interestJoining,
    entry.trainingDetails,
    entry.listOnPage,
    entry.listingDetails,
    entry.signature,
    entry.applicationDate,
    entry.checkoutStatus,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${BASIC_APPLICATIONS_SHEET}'!A1:P1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [row],
    },
  });
}
