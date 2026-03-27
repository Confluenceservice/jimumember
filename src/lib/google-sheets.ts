import { google } from "googleapis";

type CheckoutLogEntry = {
  timestamp: string;
  email: string;
  plan: string;
  amountPaid: number;
  sessionId: string;
  customerId: string;
};

function getSheetsClient() {
  const email = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim();
  const keyRaw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY?.trim();

  if (!email || !keyRaw) {
    throw new Error("Missing GOOGLE_SHEETS service account config.");
  }

  // The key may contain \n escape sequences from env var formatting
  const key = keyRaw.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
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
    entry.email,
    entry.plan,
    amountDisplay,
    entry.sessionId,
    entry.customerId,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "A1:F1",
    valueInputOption: "RAW",
    requestBody: {
      values: [row],
    },
  });
}
