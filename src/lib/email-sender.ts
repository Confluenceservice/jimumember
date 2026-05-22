import { google } from "googleapis";

interface EmailParams {
  to: string;
  subject: string;
  body: string;
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
  const message = [
    `To: ${params.to}`,
    `From: ${senderEmail}`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    params.body,
  ].join("\r\n");

  return Buffer.from(message).toString("base64url");
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