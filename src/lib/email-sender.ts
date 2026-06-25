import FormData from "form-data";
import Mailgun from "mailgun.js";
import { appendEmailLog } from "./google-sheets";

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
//   MAILGUN_DOMAIN    — verified sending domain (e.g. "mg.eldaa.org.nz").
//                       On a Mailgun sandbox this is the sandbox hostname;
//                       only verified recipients will receive mail.
//   MAILGUN_FROM      — full From header value, e.g.
//                       "ELDAA <no-reply@mg.eldaa.org.nz>"

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
  | "associate_confirmation"
  | "application_notification"
  | "associate_application_notification"
  | "resume_link"
  | "renewal_pd_log"
  | "renewal_admin_notification";

export async function sendEmail(
  params: EmailParams,
  meta?: { template: EmailTemplate; applicantId?: string },
): Promise<void> {
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

export async function sendProfessionalConfirmation(
  toEmail: string,
  fullName: string,
  applicantId?: string,
): Promise<void> {
  const subject = "Your ELDAA Professional Membership Application";

  const body = `Dear ${fullName},

Thank you for your application to become a Professional Member of ELDAA. We will process your application and get back to you as soon as we can.

We look forward to seeing you soon.

Kia ora,
ELDAA Committee`;

  await sendEmail(
    { to: toEmail, subject, body },
    { template: "confirmation", applicantId },
  );
}

export async function sendAssociateConfirmation(
  toEmail: string,
  fullName: string,
  listOnPage: boolean,
  associateApplicationId?: string,
): Promise<void> {
  const listNote = listOnPage
    ? "You have requested to be listed on our Associate Member list on our website — we will process that shortly."
    : "You have not requested to be listed at this time. If you would like to be added in future, please email us at membership@eldaa.org.nz.";

  const subject = "Welcome to ELDAA — Associate Membership Confirmed";

  const body = `Welcome to ELDAA ☺

Dear ${fullName},

We would like to officially welcome you on board the End of Life Doula Alliance of Aotearoa as an Associate Member. We are delighted you are joining us in this role, and look forward to supporting you in your mahi.

${listNote}

Associate Member Resources: Access your resources at https://eldaa.org.nz — Members Area — Members Login. If you haven't signed up yet, click 'Sign up' and we will approve your access. If you're already a member, click 'Log In'.

You will find recordings of our educational sessions and other relevant information there.

Meetings: We look forward to seeing you at our membership meetings — this is a great way to connect with your peers. We hold educational sessions (all members — last Monday of the month) and, every other month, a confidential meetup for professional members only (last Tuesday of the month). We send out links prior to each meeting.

Networking: We encourage you to connect with others in your area through our Doula hubs. Please reach out to any of us at any time if you need support — we are here for each other.

Questions? Email us at membership@eldaa.org.nz — we would love your feedback and any ideas you have to support you in your mahi.

Again, welcome on board ☺

Kia ora,
ELDAA Committee`;

  await sendEmail(
    { to: toEmail, subject, body, replyTo: "membership@eldaa.org.nz" },
    { template: "associate_confirmation", applicantId: associateApplicationId },
  );
}

export async function sendAssociateApplicationNotification(
  toEmail: string,
  associateName: string,
  docUrl: string,
  associateApplicationId?: string,
): Promise<void> {
  const subject = `New Associate Membership Application — ${associateName}`;

  const body = `A new associate membership application has been received and the review document is ready.

Applicant: ${associateName}
Review document: ${docUrl}

Please log in to review the application and continue the membership process.

ELDAA`;

  await sendEmail(
    { to: toEmail, subject, body },
    { template: "associate_application_notification", applicantId: associateApplicationId },
  );
}

export async function sendProfessionalApplicationNotification(
  toEmail: string,
  applicantName: string,
  docUrl: string,
  applicantId?: string,
): Promise<void> {
  const subject = `New Professional Membership Application — ${applicantName}`;

  const body = `A new professional membership application has been received and the review document is ready.

Applicant: ${applicantName}
Review document: ${docUrl}

Please log in to review the application and continue the membership process.

ELDAA`;

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
  const subject = "Log your Professional Development — ELDAA Membership Renewal";

  const body = `Dear ${fullName},

Thank you for renewing your ELDAA Professional Membership.

As a reminder, Professional Members are required to log at least 10 hours of Professional Development each year. You can log your PD activities at any time using the link below:

${pdLogLink}

Please keep this email — it's your personal link to update your PD record.

Kia ora,
ELDAA Committee`;

  await sendEmail(
    { to: toEmail, subject, body, replyTo: "membership@eldaa.org.nz" },
    { template: "renewal_pd_log", applicantId: renewalId },
  );
}

export async function sendResumeLink(
  toEmail: string,
  fullName: string,
  resumeLink: string,
  applicantId?: string,
): Promise<void> {
  const subject = "Your ELDAA Professional Membership Application";

  const body = `Dear ${fullName},

Thank you for starting your Professional Membership application with ELDAA.

To continue your application, please click the link below:
${resumeLink}

This link will allow you to upload your required documents and complete your application.

If you did not start this application, please ignore this email.

Best regards,
ELDAA`;

  await sendEmail(
    { to: toEmail, subject, body },
    { template: "resume_link", applicantId },
  );
}

export async function sendRenewalAdminNotification(
  toEmail: string,
  tier: "pm" | "am",
  memberName: string,
  memberEmail: string,
  renewalId: string,
  amountPaidCents: number,
): Promise<void> {
  const tierLabel = tier === "pm" ? "Professional Member" : "Associate Member";
  const amount = (amountPaidCents / 100).toFixed(2);
  const subject = `Membership renewal completed — ${memberName} (${tierLabel})`;

  const body = `A membership renewal has been completed.

Member: ${memberName}
Email: ${memberEmail}
Tier: ${tierLabel}
Amount paid: NZ$${amount}
Renewal ID: ${renewalId}

The member has been emailed a link to log their Professional Development activities (PM only).

ELDAA`;

  await sendEmail(
    { to: toEmail, subject, body, replyTo: "membership@eldaa.org.nz" },
    { template: "renewal_admin_notification", applicantId: renewalId },
  );
}
