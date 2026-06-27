import type { APIRoute } from "astro";
import crypto from "node:crypto";
import * as Sentry from "@sentry/node";
import {
  createApplicantRow,
  getApplicantByToken,
  getApplicantByEmail,
  updateApplicantFormData,
  validateCompletion,
  markEmailVerified,
} from "../../../lib/upload-sheet";
import { sendResumeLink } from "../../../lib/email-sender";
import { logger } from "../../../lib/logger";
import { getSiteBaseUrl } from "../../../lib/stripe-checkout";
import { listDriveFiles } from "../../../lib/drive-files";
const applicantSaveQueues = new Map<string, Promise<void>>();
async function queueApplicantSave(applicantId: string, operation: () => Promise<void>): Promise<void> {
  const previous = applicantSaveQueues.get(applicantId) ?? Promise.resolve();
  let current: Promise<void>;
  current = previous
    .catch(() => {})
    .then(operation)
    .finally(() => {
      if (applicantSaveQueues.get(applicantId) === current) {
        applicantSaveQueues.delete(applicantId);
      }
    });
  applicantSaveQueues.set(applicantId, current);
  return current;
}

// Reject empty, CR/LF, and obviously malformed addresses. The CR/LF guard
// closes the email-header-injection path in src/lib/email-sender.ts (the To:
// line is interpolated into raw RFC822 headers).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value: string): boolean {
  if (!value) return false;
  if (/[\r\n]/.test(value)) return false;
  return EMAIL_RE.test(value);
}

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get("token");

  if (!token) {
    return Response.json({ status: "new" });
  }

  try {
    const applicant = await getApplicantByToken(token);

    if (!applicant) {
      return Response.json({ status: "new", error: "Invalid or expired link" });
    }

    if (applicant.paid === "TRUE") {
      return Response.json({
        status: "paid",
        firstName: applicant.firstName,
        lastName: applicant.lastName,
      });
    }

    // The token came from a magic-link email the applicant controls. Flip
    // email_verified to TRUE on load (best-effort — don't block the response).
    if (applicant.emailVerified !== "TRUE") {
      try {
        await markEmailVerified(applicant.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("markEmailVerified_failed", { applicantId: applicant.id, error: msg });
      }
    }

    // Get file list from Drive Files (sheet may not exist yet for new applicants)
    let docsUploaded: Record<string, { fileId: string; filename: string; uploadedAt: string }[]> = {};
    try {
      const files = await listDriveFiles(applicant.id);
      for (const file of files) {
        if (!docsUploaded[file.docType]) {
          docsUploaded[file.docType] = [];
        }
        docsUploaded[file.docType].push({
          fileId: file.fileId,
          filename: file.originalFilename,
          uploadedAt: file.uploadedAt,
        });
      }
    } catch (e) {
      // Drive Files sheet doesn't exist yet — that's fine, no files uploaded
    }

    // Determine completion via validateCompletion
    let isComplete = false;
    try {
      isComplete = await validateCompletion(applicant.id);
    } catch (e) {
      // If validateCompletion fails (e.g. partial data), treat as incomplete
    }

    const status = isComplete ? "complete" : "partial";

    return Response.json({
      applicantId: applicant.id,
      status,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
      email: applicant.email,
      phone: applicant.phone,
      docsUploaded,
      // Form fields for pre-population
      dateOfBirth: applicant.dateOfBirth,
      ethnicity: applicant.ethnicity,
      address: applicant.address,
      postalAddress: applicant.postalAddress,
      businessName: applicant.businessName,
      website: applicant.website,
      qualifications: applicant.qualifications,
      experience: applicant.experience,
      furtherRequirements: applicant.furtherRequirements,
      coreCompetencies: applicant.coreCompetencies,
      referee1: {
        name: applicant.referee1Name,
        role: applicant.referee1Role,
        email: applicant.referee1Email,
        phone: applicant.referee1Phone,
      },
      referee2: {
        name: applicant.referee2Name,
        role: applicant.referee2Role,
        email: applicant.referee2Email,
        phone: applicant.referee2Phone,
      },
      declarationAccuracy: applicant.declarationAccuracy,
      declarationEthics: applicant.declarationEthics,
      declarationScope: applicant.declarationScope,
      declarationDoulaServices: applicant.declarationDoulaServices,
      declarationInterview: applicant.declarationInterview,
      declarationProfessionalDev: applicant.declarationProfessionalDev,
      declarationCriminalCheck: applicant.declarationCriminalCheck,
      declarationMeetings: applicant.declarationMeetings,
      complete: isComplete,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { extra: { token } });
    logger.error("resume_link_load_failed", {
      token,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return Response.json(
      { status: "error", error: "Failed to load application. Please try again." },
      { status: 500 }
    );
  }
};

export const POST: APIRoute = async ({ request, url }) => {
  let payload: Record<string, unknown>;

  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const resumeToken = (payload.token as string)?.trim() || "";
  const firstName = (payload.firstName as string)?.trim() || "";
  const lastName = (payload.lastName as string)?.trim() || "";
  const phone = (payload.phone as string)?.trim() || "";
  const emailRaw = (payload.email as string)?.trim() || "";
  const email = emailRaw.toLowerCase();
  const fullName = `${firstName} ${lastName}`.trim();

  if (email && !isValidEmail(email)) {
    return Response.json({ error: "Valid email is required." }, { status: 400 });
  }

  // Extract all form fields
  const dateOfBirth = (payload.dateOfBirth as string)?.trim() || "";
  const ethnicity = (payload.ethnicity as string)?.trim() || "";
  const address = (payload.address as string)?.trim() || "";
  const postalAddress = (payload.postalAddress as string)?.trim() || "";
  const businessName = (payload.businessName as string)?.trim() || "";
  const website = (payload.website as string)?.trim() || "";
  const qualifications = (payload.qualifications as string) || "";
  const experience = (payload.experience as string) || "";
  const furtherRequirements = (payload.furtherRequirements as string) || "";
  const coreCompetencies = (payload.coreCompetencies as string) || "";
  const referee1Name = (payload.referee1Name as string)?.trim() || "";
  const referee1Role = (payload.referee1Role as string)?.trim() || "";
  const referee1Email = (payload.referee1Email as string)?.trim() || "";
  const referee1Phone = (payload.referee1Phone as string)?.trim() || "";
  const referee2Name = (payload.referee2Name as string)?.trim() || "";
  const referee2Role = (payload.referee2Role as string)?.trim() || "";
  const referee2Email = (payload.referee2Email as string)?.trim() || "";
  const referee2Phone = (payload.referee2Phone as string)?.trim() || "";
  const declarationAccuracy = (payload.declarationAccuracy as string) || "";
  const declarationEthics = (payload.declarationEthics as string) || "";
  const declarationScope = (payload.declarationScope as string) || "";
  const declarationDoulaServices = (payload.declarationDoulaServices as string) || "";
  const declarationInterview = (payload.declarationInterview as string) || "";
  const declarationProfessionalDev = (payload.declarationProfessionalDev as string) || "";
  const declarationCriminalCheck = (payload.declarationCriminalCheck as string) || "";
  const declarationMeetings = (payload.declarationMeetings as string) || "";
  const declarationSignedAt = (payload.declarationSignedAt as string) || "";

  try {
    // Token branch: applicant presented a magic link they got via email. This
    // is the verified path. Keep the existing update behavior and return the
    // resume link so the client can stay in sync.
    if (resumeToken) {
      const existingApplicant = await getApplicantByToken(resumeToken);
      if (!existingApplicant) {
        return Response.json({ error: "Invalid or expired link." }, { status: 404 });
      }

      await queueApplicantSave(existingApplicant.id, async () => {
        await updateApplicantFormData(existingApplicant.id, {
          firstName: firstName || existingApplicant.firstName,
          lastName: lastName || existingApplicant.lastName,
          phone: phone || existingApplicant.phone,
          email: email || existingApplicant.email,
          dateOfBirth,
          ethnicity,
          address,
          postalAddress,
          businessName,
          website,
          qualifications,
          experience,
          furtherRequirements,
          coreCompetencies,
          referee1Name,
          referee1Role,
          referee1Email,
          referee1Phone,
          referee2Name,
          referee2Role,
          referee2Email,
          referee2Phone,
          declarationAccuracy,
          declarationEthics,
          declarationScope,
          declarationDoulaServices,
          declarationInterview,
          declarationProfessionalDev,
          declarationCriminalCheck,
          declarationMeetings,
          declarationSignedAt: declarationSignedAt || new Date().toISOString(),
        });

        // Best-effort flip to verified on first token-bearing write — the
        // GET path already does this, but if the applicant lands here first
        // (e.g. GET was blocked), make sure the row is consistent.
        if (existingApplicant.emailVerified !== "TRUE") {
          try {
            await markEmailVerified(existingApplicant.id);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn("markEmailVerified_on_post_failed", {
              applicantId: existingApplicant.id,
              error: msg,
            });
          }
        }
      });

      const siteBaseUrl = getSiteBaseUrl(url.href);
      const tokenForResumeLink = existingApplicant.resumeToken || resumeToken;
      const resumeLink = `${siteBaseUrl}/professional/apply?token=${tokenForResumeLink}`;
      return Response.json({
        success: true,
        resumeLink,
        applicantId: existingApplicant.id,
        existing: true,
      });
    }

    // No-token branch: caller has not proven control of any email. Find or
    // create a row, send the resume link, return requiresVerification with
    // no token in the body. The client must not advance the form until the
    // user clicks the emailed link.
    if (email) {
      const existingApplicant = await getApplicantByEmail(email);
      const siteBaseUrl = getSiteBaseUrl(url.href);

      let emailSent = false;
      if (existingApplicant) {
        // Resend the existing resume link. Do NOT mutate the row — the
        // submitter has not proven they control this email.
        const resumeLink = `${siteBaseUrl}/professional/apply?token=${existingApplicant.resumeToken}`;
        const existingFullName = `${existingApplicant.firstName} ${existingApplicant.lastName}`.trim();
        try {
          await sendResumeLink(
            existingApplicant.email,
            existingFullName,
            resumeLink,
            existingApplicant.id
          );
          emailSent = true;
          logger.info("resume_email_resent_existing", {
            applicantId: existingApplicant.id,
            email: existingApplicant.email,
          });
        } catch (emailError) {
          const msg = emailError instanceof Error ? emailError.message : "Unknown";
          logger.error("resume_email_resend_failed", {
            applicantId: existingApplicant.id,
            email: existingApplicant.email,
            error: msg,
          });
          Sentry.captureMessage("Failed to resend resume email", {
            extra: { applicantId: existingApplicant.id, email: existingApplicant.email },
          });
        }
        return Response.json({
          success: true,
          requiresVerification: true,
          emailSent,
        });
      }

      // New applicant. Required-field checks happen here only — the
      // existing-email resend path above does not need them.
      if (!firstName) {
        return Response.json({ error: "First name is required." }, { status: 400 });
      }
      if (!lastName) {
        return Response.json({ error: "Last name is required." }, { status: 400 });
      }

      const applicantId = crypto.randomUUID();
      const newResumeToken = crypto.randomUUID();

      // emailVerified defaults to "FALSE" in createApplicantRow — verification
      // happens when the user clicks the emailed link (the GET handler flips
      // it to TRUE).
      await createApplicantRow(
        applicantId, firstName, lastName, phone, email, newResumeToken,
        dateOfBirth, ethnicity, address, postalAddress, businessName, website,
        qualifications, experience, furtherRequirements, coreCompetencies,
        referee1Name, referee1Role, referee1Email, referee1Phone,
        referee2Name, referee2Role, referee2Email, referee2Phone,
        declarationAccuracy, declarationEthics, declarationScope,
        declarationDoulaServices, declarationInterview, declarationProfessionalDev,
        declarationCriminalCheck, declarationMeetings,
        declarationSignedAt || new Date().toISOString()
      );

      const resumeLink = `${siteBaseUrl}/professional/apply?token=${newResumeToken}`;
      try {
        await sendResumeLink(email, fullName, resumeLink, applicantId);
        emailSent = true;
        logger.info("resume_email_sent", { applicantId, email });
      } catch (emailError) {
        const msg = emailError instanceof Error ? emailError.message : "Unknown";
        logger.error("resume_email_failed", {
          applicantId,
          email,
          error: msg,
        });
        Sentry.captureMessage("Failed to send resume email", {
          extra: { applicantId, email },
        });
      }

      return Response.json({
        success: true,
        requiresVerification: true,
        emailSent,
      });
    }

    return Response.json(
      { error: "Email is required to start an application." },
      { status: 400 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { extra: { email, fullName } });
    logger.error("applicant_registration_failed", {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return Response.json(
      { error: "Failed to create application. Please try again." },
      { status: 500 }
    );
  }
};