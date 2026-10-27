import { formatMoney } from "./config";
import {
  appendToRange,
  appendRow,
  columnLetter,
  getSheetsClient,
  getSpreadsheetId,
  readRange,
  updateRange,
} from "./google-sheets-helpers";

type CheckoutLogEntry = {
  timestamp: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  plan: string;
  amountPaid: number;
  /** The provider's checkout reference (Stripe session id etc.) — column H. */
  sessionId: string;
  customerId: string;
  /** Payment provider id (column J), e.g. "stripe". */
  provider: string;
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
const NOTIFICATION_RULES_SHEET = "Notification Rules";
const NOTIFICATION_RULES_HEADERS = [
  "event",
  "recipient_email",
  "enabled",
  "description",
] as const;
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

export async function appendCheckoutLog(entry: CheckoutLogEntry): Promise<void> {
  const amountDisplay = formatMoney(entry.amountPaid);

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
    entry.provider,
  ];

  await appendToRange("A1:J1", row);
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
  const row = [
    entry.timestamp,
    entry.to,
    entry.subject,
    entry.template,
    entry.applicantId ?? "",
    entry.result,
    entry.error ?? "",
  ];

  await appendToRange(`'${EMAIL_LOG_SHEET}'!A1:G1`, row);
}

export async function appendBasicApplication(
  entry: AssociateApplicationEntry,
): Promise<void> {
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

  await appendRow(BASIC_APPLICATIONS_SHEET, ASSOCIATE_APPLICATIONS_HEADERS, row);
}

/**
 * Update the checkout_status column of a basic application row, located by
 * application_id. Returns true if a row was updated, false if no matching
 * application_id was found. Called from the Stripe webhook on
 * checkout.session.completed so the sheet advances past "checkout_requested"
 * (appendBasicApplication only ever writes the initial status).
 */
export async function updateBasicApplicationStatus(
  applicationId: string,
  checkoutStatus: string,
): Promise<boolean> {
  const idCol = columnLetter(ASSOCIATE_APPLICATIONS_HEADERS.indexOf("application_id") + 1);
  const statusCol = columnLetter(ASSOCIATE_APPLICATIONS_HEADERS.indexOf("checkout_status") + 1);

  const ids = await readRange(`'${BASIC_APPLICATIONS_SHEET}'!${idCol}2:${idCol}`);
  const matchIndex = ids.findIndex((r) => (r[0] ?? "") === applicationId);
  if (matchIndex === -1) return false;

  // +2: data starts at row 2 (row 1 is headers), findIndex is 0-based.
  const rowNumber = matchIndex + 2;
  await updateRange(`'${BASIC_APPLICATIONS_SHEET}'!${statusCol}${rowNumber}`, [[checkoutStatus]]);
  return true;
}

/**
 * Ensure the admin-editable "Notification Rules" tab exists.
 *
 * IMPORTANT: this is intentionally self-contained and does NOT use the shared
 * `ensureSheetWithHeaders` helper. That helper runs `values.update` on the
 * header row unconditionally (outside its `if (!hasSheet)` guard), which would
 * silently revert any admin edits to the header row on every webhook call.
 * Here we write headers exactly once, at tab-creation time only.
 */
async function ensureNotificationRulesSheet(): Promise<void> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const hasSheet = spreadsheet.data.sheets?.some(
    (sheet) => sheet.properties?.title === NOTIFICATION_RULES_SHEET,
  );

  // Tab already exists — never touch headers (preserve admin edits).
  if (hasSheet) return;

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: NOTIFICATION_RULES_SHEET } } },
        ],
      },
    });
  } catch (err) {
    // Concurrent webhooks may both create the tab; swallow the loser's error.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already exists/i.test(msg)) throw err;
    return; // tab now exists (created by the other call); headers already written there.
  }

  const headerRangeEnd = String.fromCharCode(
    64 + NOTIFICATION_RULES_HEADERS.length,
  );
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${NOTIFICATION_RULES_SHEET}'!A1:${headerRangeEnd}1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [Array.from(NOTIFICATION_RULES_HEADERS)],
    },
  });
}

/**
 * Read notification routing rules from the "Notification Rules" tab.
 *
 * No caching by design: the tab is admin-editable and changes must take effect
 * on the next webhook with no redeploy. Rows missing an event or recipient are
 * dropped. The `enabled` column is returned verbatim for the caller to gate on.
 */
export async function readNotificationRules(): Promise<
  Array<{ event: string; recipient_email: string; enabled: string }>
> {
  const spreadsheetId = getSpreadsheetId();
  await ensureNotificationRulesSheet();

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${NOTIFICATION_RULES_SHEET}'!A2:C`,
  });

  const rows = res.data.values ?? [];
  return rows
    .filter((r) => r[0] && r[1])
    .map((r) => ({
      event: String(r[0]),
      recipient_email: String(r[1]),
      enabled: String(r[2] ?? ""),
    }));
}
