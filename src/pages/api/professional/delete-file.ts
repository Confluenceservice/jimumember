import type { APIRoute } from "astro";
import * as Sentry from "@sentry/node";
import { getApplicantByToken, updateDocCount } from "../../../lib/upload-sheet";
import { softDeleteDriveFile, listDriveFiles, getDriveFileCounts } from "../../../lib/drive-files";
import { logger } from "../../../lib/logger";
import type { DocType } from "../../../lib/upload-sheet";

export const POST: APIRoute = async ({ request }) => {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const fileId = (payload.fileId as string)?.trim();
  const token = (payload.token as string)?.trim();

  if (!fileId || !token) {
    return Response.json({ error: "fileId and token are required." }, { status: 400 });
  }

  const applicant = await getApplicantByToken(token);
  if (!applicant) {
    return Response.json({ error: "Invalid or expired session." }, { status: 400 });
  }

  const files = await listDriveFiles(applicant.id);
  const file = files.find((f) => f.fileId === fileId);

  if (!file) {
    return Response.json({ error: "File not found." }, { status: 404 });
  }

  try {
    await softDeleteDriveFile(fileId);

    const counts = await getDriveFileCounts(applicant.id);
    if (file.docType) {
      const currentCount = counts[file.docType as DocType] || 0;
      await updateDocCount(applicant.id, file.docType, currentCount);
    }

    logger.info("document_deleted", {
      applicantId: applicant.id,
      fileId,
      docType: file.docType,
    });

    return Response.json({ success: true });
  } catch (error) {
    Sentry.captureException(error, { extra: { applicantId: applicant.id, fileId } });
    logger.error("document_delete_failed", {
      applicantId: applicant.id,
      fileId,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return Response.json({ error: "Failed to delete file." }, { status: 500 });
  }
};