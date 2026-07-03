import FormData from "form-data";
import Mailgun from "mailgun.js";
import { appendEmailLog } from "./google-sheets";
import { TIERS } from "./forms/tiers";
import { formatMoney } from "./config";

/**
 * Phase K: look up tier label from TIERS config by storageValue. O(N) over
 * the (small) TIERS list — no hardcoded "pm"/"am" branch.
 */
function tierLabelFor(storageValue: string): string {
  for (const t of Object.values(TIERS)) {
    if (t.storageValue === storageValue) return t.label;
  }
  return storageValue;
}

interface EmailParams {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}

// In staging we prefix every outgoing subject with "[TESTING] " so the
// recipient (and any inbox-searching user) can tell at a glance that the
// message came from a non-production env. The same STAGING_PREFIX env var
// that already drives `getStagingPrefix()` in src/lib/staging.ts for Drive
// folder names also gates this prefix — one switch to flip all staging
// signals on or off. Production + local dev leave STAGING_PREFIX unset, so
// the prefix is the empty string and subjects are sent verbatim.
function getEmailSubjectPrefix(): string {
  return process.env.STAGING_PREFIX?.trim() ? "[TESTING] " : "";
}

// Mailgun HTTP API via the official JS SDK. Replaces the previous Gmail
// OAuth path — Gmail's Workspace Cloud session-control policy reauthed the
// refresh token every ~24h, surfacing as `invalid_rapt` and degrading
// /api/health to "gmail: disconnected" on a recurring cycle.
//
// Env contract:
//   MAILGUN_API_KEY   — Mailgun private API key (starts with "key-")
//   MAILGUN_DOMAIN    — verified sending domain (e.g. "mg.example.com").
//                       On a Mailgun sandbox this is the sandbox hostname;
//                       only verified recipients will receive mail.
//   MAILGUN_FROM      — full From header value, e.g.
//                       "Re:Member <no-reply@mg.example.com>"

function getMailgunConfig(): {
  apiKey: string;
  domain: string;
  from: string;
} {
  const apiKey = process.env.MAILGUN_API_KEY?.trim();
  const domain = process.env.MAILGUN_DOMAIN?.trim();
  const from = process.env.MAILGUN_FROM?.trim();

  if (!apiKey || !domain || !from) {
    throw new Error(
      "Missing Mailgun config. Set MAILGUN_API_KEY, MAILGUN_DOMAIN, and MAILGUN_FROM.",
    );
  }

  return { apiKey, domain, from };
}

// Org identity — read once at call time so tests can monkey-patch env.
function getOrgName(): string {
  return process.env.ORG_NAME?.trim() || "Re:Member";
}
function getSupportEmail(): string {
  return process.env.SUPPORT_EMAIL?.trim() || "membership@example.com";
}
function getOrgUrl(): string {
  return process.env.PUBLIC_ORG_URL?.trim() || "https://example.com";
}

let _client: ReturnType<Mailgun["client"]> | null = null;
function getMailgunClient() {
  if (_client) return _client;
  const { apiKey } = getMailgunConfig();
  const mailgun = new Mailgun(FormData);
  _client = mailgun.client({ username: "api", key: apiKey });
  return _client;
}

export type EmailTemplate =
  | "confirmation"
  | "basic_confirmation"
  | "application_notification"
  | "basic_application_notification"
  | "resume_link"
  | "renewal_pd_log"
  | "renewal_admin_notification";

export async function sendEmail(
  params: EmailParams,
  meta?: { template: EmailTemplate; applicantId?: string },
): Promise<void> {
  // E2E hooks — no-op in every non-E2E environment (vars unset).
  // A global E2E_FORCE_EMAIL_FAIL forces every send to throw. Under E2E_STUB a
  // single built server must drive BOTH the success and failure paths, so a
  // per-request sentinel is used too: a recipient containing "forcefail" throws
  // the deterministic error the apply route surfaces as `emailError` (the
  // bug-005 diagnostics path); any other recipient reports success WITHOUT
  // touching Mailgun or appendEmailLog (which would hit Google Sheets). All
  // returns are BEFORE the try/appendEmailLog block by design. See e2e/apply.spec.ts.
  if (process.env.E2E_FORCE_EMAIL_FAIL === "1") {
    throw new Error("E2E forced email failure");
  }
  if (process.env.E2E_STUB === "1") {
    if (params.to.toLowerCase().includes("forcefail")) {
      throw new Error("E2E forced email failure");
    }
    return;
  }

  const { domain, from } = getMailgunConfig();
  const mg = getMailgunClient();
  const timestamp = new Date().toISOString();
  const subject = `${getEmailSubjectPrefix()}${params.subject}`;

  try {
    await mg.messages.create(domain, {
      from,
      to: [params.to],
      subject,
      text: params.body,
      ...(params.replyTo ? { "h:Reply-To": params.replyTo } : {}),
    });
    await appendEmailLog({
      timestamp,
      to: params.to,
      subject,
      template: meta?.template ?? "unknown",
      applicantId: meta?.applicantId,
      result: "sent",
    });
  } catch (err) {
    await appendEmailLog({
      timestamp,
      to: params.to,
      subject,
      template: meta?.template ?? "unknown",
      applicantId: meta?.applicantId,
      result: "failed",
      error: String(err),
    });
    throw err;
  }
}

export async function sendAdvancedConfirmation(
  toEmail: string,
  fullName: string,
  applicantId?: string,
): Promise<void> {
  const orgName = getOrgName();
  const subject = `Your ${orgName} Advanced Membership Application`;

  const body = `Dear ${fullName},

Thank you for your application to become a Advanced Member of ${orgName}. We will process your application and get back to you as soon as we can.

We look forward to seeing you soon.

Kind regards,
The ${orgName} Committee`;

  await sendEmail(
    { to: toEmail, subject, body },
    { template: "confirmation", applicantId },
  );
}

export async function sendBasicConfirmation(
  toEmail: string,
  fullName: string,
  listOnPage: boolean,
  basicApplicationId?: string,
): Promise<void> {
  const orgName = getOrgName();
  const support = getSupportEmail();
  const orgUrl = getOrgUrl();
  const listNote = listOnPage
    ? "You have requested to be listed on our Basic Member list on our website — we will process that shortly."
    : `You have not requested to be listed at this time. If you would like to be added in future, please email us at ${support}.`;

  const subject = `Welcome to ${orgName} — Basic Membership Confirmed`;

  const body = `Welcome to ${orgName} ☺

Dear ${fullName},

We would like to officially welcome you on board as an Basic Member. We are delighted you are joining us in this role.

${listNote}

Basic Member Resources: Access your resources at ${orgUrl} — Members Area — Members Login. If you haven't signed up yet, click 'Sign up' and we will approve your access. If you're already a member, click 'Log In'.

You will find recordings of our educational sessions and other relevant information there.

Meetings: We look forward to seeing you at our membership meetings — this is a great way to connect with your peers. Details are circulated to members in advance.

Networking: We encourage you to connect with others in your area. Please reach out to any of us at any time if you need support — we are here for each other.

Questions? Email us at ${support} — we would love your feedback and any ideas you have to support you.

Again, welcome on board ☺

Kind regards,
The ${orgName} Committee`;

  await sendEmail(
    { to: toEmail, subject, body, replyTo: support },
    { template: "basic_confirmation", applicantId: basicApplicationId },
  );
}

export async function sendBasicApplicationNotification(
  toEmail: string,
  associateName: string,
  docUrl: string,
  basicApplicationId?: string,
): Promise<void> {
  const orgName = getOrgName();
  const subject = `New Basic Membership Application — ${associateName}`;

  const body = `A new associate membership application has been received and the review document is ready.

Applicant: ${associateName}
Review document: ${docUrl}

Please log in to review the application and continue the membership process.

${orgName}`;

  await sendEmail(
    { to: toEmail, subject, body },
    { template: "basic_application_notification", applicantId: basicApplicationId },
  );
}

export async function sendAdvancedApplicationNotification(
  toEmail: string,
  applicantName: string,
  docUrl: string,
  applicantId?: string,
): Promise<void> {
  const orgName = getOrgName();
  const subject = `New Advanced Membership Application — ${applicantName}`;

  const body = `A new professional membership application has been received and the review document is ready.

Applicant: ${applicantName}
Review document: ${docUrl}

Please log in to review the application and continue the membership process.

${orgName}`;

  await sendEmail(
    { to: toEmail, subject, body },
    { template: "application_notification", applicantId },
  );
}

export async function sendRenewalPdLogLink(
  toEmail: string,
  fullName: string,
  pdLogLink: string,
  renewalId?: string,
): Promise<void> {
  const orgName = getOrgName();
  const support = getSupportEmail();
  const subject = `Log your Professional Development — ${orgName} Membership Renewal`;

  const body = `Dear ${fullName},

Thank you for renewing your ${orgName} Advanced Membership.

As a reminder, Advanced Members are required to log at least 10 hours of Professional Development each year. You can log your PD activities at any time using the link below:

${pdLogLink}

Please keep this email — it's your personal link to update your PD record.

Kind regards,
The ${orgName} Committee`;

  await sendEmail(
    { to: toEmail, subject, body, replyTo: support },
    { template: "renewal_pd_log", applicantId: renewalId },
  );
}

export async function sendResumeLink(
  toEmail: string,
  fullName: string,
  resumeLink: string,
  applicantId?: string,
): Promise<void> {
  const orgName = getOrgName();
  const subject = `Your ${orgName} Advanced Membership Application`;

  const body = `Dear ${fullName},

Thank you for starting your Advanced Membership application with ${orgName}.

To continue your application, please click the link below:
${resumeLink}

This link will allow you to upload your required documents and complete your application.

If you did not start this application, please ignore this email.

Best regards,
${orgName}`;

  await sendEmail(
    { to: toEmail, subject, body },
    { template: "resume_link", applicantId },
  );
}

export async function sendRenewalAdminNotification(
  toEmail: string,
  /** Phase K: tier widened from "pm"|"am" literal to string so any
   *  TierConfig.storageValue works. Display label is resolved from TIERS. */
  tier: string,
  memberName: string,
  memberEmail: string,
  renewalId: string,
  amountPaidCents: number,
  sheetUrl?: string,
): Promise<void> {
  const orgName = getOrgName();
  const support = getSupportEmail();
  const tierLabel = tierLabelFor(tier);
  const subject = `Membership renewal completed — ${memberName} (${tierLabel})`;

  const body = `A membership renewal has been completed.

Member: ${memberName}
Email: ${memberEmail}
Tier: ${tierLabel}
Amount paid: ${formatMoney(amountPaidCents)}
Renewal ID: ${renewalId}
${sheetUrl ? `Renewals sheet: ${sheetUrl}` : ""}

The member has been emailed a link to log their Professional Development activities (PM only).

${orgName}`;

  await sendEmail(
    { to: toEmail, subject, body, replyTo: support },
    { template: "renewal_admin_notification", applicantId: renewalId },
  );
}
