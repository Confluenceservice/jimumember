import type { APIRoute } from "astro";
import * as Sentry from "@sentry/node";
import { getApplicantByToken } from "../../../lib/upload-sheet";
import { sendResumeLink } from "../../../lib/email-sender";
import { logger } from "../../../lib/logger";
import { getSiteBaseUrl } from "../../../lib/stripe-checkout";

// Resends the resume-link email to the applicant identified by resume token.
// Used by the in-form "Email me my access link" button so applicants who
// lost the original email (spam folder, deleted email, etc.) can recover
// their access link mid-form.
export const POST: APIRoute = async ({ request, url }) => {
  let payload: Record<string, unknown>;

  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const token = (payload.token as string)?.trim() || "";
  if (!token) {
    return Response.json(
      { error: "Token is required." },
      { status: 400 }
    );
  }

  let applicant;
  try {
    applicant = await getApplicantByToken(token);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { extra: { tokenPrefix: token.substring(0, 8) } });
    logger.error("resend_link_lookup_failed", {
      tokenPrefix: token.substring(0, 8),
      error: errorMessage,
    });
    return Response.json(
      { error: "Failed to look up application. Please try again." },
      { status: 500 }
    );
  }

  if (!applicant) {
    return Response.json(
      { error: "Invalid or expired link." },
      { status: 404 }
    );
  }

  const applicantEmail = (applicant.email || "").trim();
  if (!applicantEmail) {
    return Response.json(
      { error: "No email on file. Please complete Step 1 of the form first." },
      { status: 400 }
    );
  }

  const siteBaseUrl = getSiteBaseUrl(url.href);
  const resumeLink = `${siteBaseUrl}/advanced/apply?token=${token}`;

  const fullName = `${applicant.firstName || ""} ${applicant.lastName || ""}`.trim() || "Applicant";

  try {
    await sendResumeLink(applicantEmail, fullName, resumeLink, applicant.id);
    logger.info("resume_email_resent", {
      applicantId: applicant.id,
      email: applicantEmail,
    });
    return Response.json({
      success: true,
      emailSent: true,
      resumeLink,
    });
  } catch (emailError) {
    const errorMessage = emailError instanceof Error ? emailError.message : String(emailError);
    Sentry.captureException(emailError, {
      extra: { applicantId: applicant.id, email: applicantEmail },
    });
    logger.error("resume_email_resend_failed", {
      applicantId: applicant.id,
      email: applicantEmail,
      error: errorMessage,
    });
    return Response.json(
      {
        error: "Could not send the email. Please try again in a moment.",
        resumeLink,
      },
      { status: 500 }
    );
  }
};
