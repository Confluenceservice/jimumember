import { google } from "googleapis";

interface EmailParams {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

function getSenderEmail(): string {
  const sender =
    process.env.GMAIL_SENDER_EMAIL?.trim() || process.env.GMAIL_SENDER?.trim();

  if (!sender) {
    throw new Error("Missing GMAIL_SENDER_EMAIL.");
  }

  return sender;
}

function getOAuthConfig():
  | { clientId: string; clientSecret: string; refreshToken: string }
  | null {
  const clientId =
    process.env.GMAIL_OAUTH_CLIENT_ID?.trim() ||
    process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret =
    process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken =
    process.env.GMAIL_OAUTH_REFRESH_TOKEN?.trim() ||
    process.env.GMAIL_REFRESH_TOKEN?.trim();

  const anyConfigured = clientId || clientSecret || refreshToken;
  if (!anyConfigured) return null;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Incomplete Gmail OAuth config. Set GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, and GMAIL_OAUTH_REFRESH_TOKEN."
    );
  }

  return { clientId, clientSecret, refreshToken };
}

async function getGmailClient() {
  const oauthConfig = getOAuthConfig();

  if (oauthConfig) {
    const oauthClient = new google.auth.OAuth2(
      oauthConfig.clientId,
      oauthConfig.clientSecret
    );
    oauthClient.setCredentials({ refresh_token: oauthConfig.refreshToken });
    return google.gmail({ version: "v1", auth: oauthClient });
  }

  const googleAuth = new google.auth.GoogleAuth({
    scopes: [GMAIL_SEND_SCOPE],
  });
  return google.gmail({ version: "v1", auth: googleAuth });
}

function createMessage(params: EmailParams, senderEmail: string): string {
  const headers = [
    `To: ${params.to}`,
    `From: ${senderEmail}`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
  ];
  if (params.replyTo) {
    headers.push(`Reply-To: ${params.replyTo}`);
  }
  headers.push("", params.body);
  return Buffer.from(headers.join("\r\n")).toString("base64url");
}

export async function sendEmail(params: EmailParams): Promise<void> {
  const senderEmail = getSenderEmail();
  const gmail = await getGmailClient();
  const message = createMessage(params, senderEmail);

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: message,
    },
  });
}

export async function sendProfessionalConfirmation(
  toEmail: string,
  fullName: string
): Promise<void> {
  const subject = "Your ELDAA Professional Membership Application";

  const body = `Dear ${fullName},

Thank you for your application to become a Professional Member of ELDAA. We will process your application and get back to you as soon as we can.

We look forward to seeing you soon.

Kia ora,
ELDAA Committee`;

  await sendEmail({
    to: toEmail,
    subject,
    body,
  });
}

export async function sendAssociateConfirmation(
  toEmail: string,
  fullName: string,
  listOnPage: boolean
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

  await sendEmail({
    to: toEmail,
    subject,
    body,
    replyTo: "membership@eldaa.org.nz",
  });
}
  toEmail: string,
  applicantName: string,
  docUrl: string
): Promise<void> {
  const subject = `New Professional Membership Application — ${applicantName}`;

  const body = `A new professional membership application has been received and the review document is ready.

Applicant: ${applicantName}
Review document: ${docUrl}

Please log in to review the application and continue the membership process.

ELDAA`;

  await sendEmail({
    to: toEmail,
    subject,
    body,
  });
}

export async function sendResumeLink(
  toEmail: string,
  fullName: string,
  resumeLink: string
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

  await sendEmail({
    to: toEmail,
    subject,
    body,
  });
}