import { formatMoney } from "./config";
import { appendToRange, appendRow } from "./google-sheets-helpers";

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
  ];

  await appendToRange("A1:I1", row);
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
