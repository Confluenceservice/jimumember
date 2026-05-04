import { google } from "googleapis";

interface EmailParams {
  to: string;
  subject: string;
  body: string;
}

function getGmailClient() {
  const email = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim();
  const keyRaw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY?.trim();

  if (!email || !keyRaw) {
    throw new Error("Missing GOOGLE_SHEETS service account config.");
  }

  const key = keyRaw.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
    ],
  });

  return google.gmail({ version: "v1", auth });
}

function createMessage(params: EmailParams): string {
  const message = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "",
    params.body,
  ].join("\n");

  return Buffer.from(message).toString("base64url");
}

export async function sendEmail(params: EmailParams): Promise<void> {
  const gmail = getGmailClient();
  const message = createMessage(params);

  // Use the service account email as the sender
  // Note: This requires domain-wide delegation or the service account
  // to be added as a sending authority in Google Workspace
  const senderEmail = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim();

  if (!senderEmail) {
    throw new Error("Missing GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL.");
  }

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: message,
    },
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