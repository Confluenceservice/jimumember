import type { APIRoute } from "astro";
import crypto from "node:crypto";
import * as Sentry from "@sentry/node";
import { getApplicantByToken, updateDocCount, REQUIRED_DOC_TYPES, type DocType } from "../../../lib/upload-sheet";
import { addDriveFile, getDriveFileCounts } from "../../../lib/drive-files";
import { google } from "googleapis";
import { logger } from "../../../lib/logger";
import { Readable } from "node:stream";

function getDriveClient() {
  const email = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim();
  const keyRaw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY?.trim();

  if (!email || !keyRaw) {
    throw new Error("Missing GOOGLE_SHEETS service account config.");
  }

  const key = keyRaw.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({ version: "v3", auth });
}

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Magic bytes for file type verification
const MAGIC_BYTES: Record<string, number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // %PDF
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/gif": [0x47, 0x49, 0x46, 0x38], // GIF8
  "application/msword": [0xd0, 0xcf, 0x11, 0xe0], // OLE compound document
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    0x50, 0x4b, 0x03, 0x04, // ZIP header (DOCX is a ZIP)
  ],
};

function verifyMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const magic = MAGIC_BYTES[mimeType];
  if (!magic) return false;

  // Check first bytes match
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) return false;
  }
  return true;
}

function detectMimeTypeFromBytes(buffer: Buffer): string | null {
  // Check against known magic bytes
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "application/pdf";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "image/gif";
  }
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    return "application/msword";
  }
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    // Could be DOCX or other ZIP-based Office file
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

async function ensureFolderExists(
  drive: ReturnType<typeof google.drive>,
  parentId: string,
  folderName: string
): Promise<string> {
  // Check if folder exists (supports Shared Drives)
  const response = await drive.files.list({
    q: `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (response.data.files && response.data.files.length > 0) {
    const fileId = response.data.files[0].id;
    if (!fileId) {
      throw new Error(`Folder ${folderName} not found`);
    }
    return fileId;
  }

  // Create folder (supports Shared Drives)
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  const folderId = folder.data.id;
  if (!folderId) {
    throw new Error(`Failed to create folder ${folderName}`);
  }
  return folderId;
}

export const POST: APIRoute = async ({ request }) => {
  const contentType = request.headers.get("content-type") || "";
  let token: string;
  let docType: string;
  let filename: string;
  let mimeType: string;
  let buffer: Buffer;

  logger.info("upload_request_received", { contentType });

  if (contentType.includes("application/json")) {
    // JSON mode: receive base64-encoded file data
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    token = (payload.token as string)?.trim();
    docType = (payload.docType as string)?.trim();
    filename = (payload.filename as string)?.trim();
    mimeType = (payload.mimeType as string)?.trim();
    const base64Data = payload.data as string;

    let tmpBuffer: Buffer;
    try {
      tmpBuffer = Buffer.from(base64Data, "base64");
    } catch {
      return Response.json({ error: "Invalid base64 data." }, { status: 400 });
    }
    buffer = tmpBuffer;

    logger.info("upload_payload_parsed", { token: token?.substring(0, 8), docType, filename, mimeType, bufferLen: buffer.length });
  } else if (contentType.includes("multipart/form-data")) {
    // Multipart mode: receive file directly (fallback for compatibility)
    const formData = await request.formData();
    token = formData.get("token") as string;
    docType = formData.get("docType") as string;
    const file = formData.get("file") as File | null;

    if (!token) return Response.json({ error: "Token is required." }, { status: 400 });
    if (!docType) return Response.json({ error: "Document type is required." }, { status: 400 });
    if (!file) return Response.json({ error: "File is required." }, { status: 400 });

    filename = file.name;
    mimeType = file.type;
    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    logger.info("upload_payload_parsed_multipart", { token: token?.substring(0, 8), docType, filename, mimeType, bufferLen: buffer.length });
  } else {
    return Response.json(
      { error: "Content-Type must be application/json or multipart/form-data." },
      { status: 400 }
    );
  }

  const allDocTypes = [...REQUIRED_DOC_TYPES, "insurance"] as const;
  if (!allDocTypes.includes(docType as typeof allDocTypes[number])) {
    logger.warn("upload_bad_doctype", { docType });
    return Response.json({ error: "Valid document type is required." }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    logger.warn("upload_bad_mimetype", { mimeType });
    return Response.json(
      { error: "File type not allowed. Use PDF, JPEG, PNG, GIF, or Word documents." },
      { status: 400 }
    );
  }

  if (buffer.length > MAX_FILE_SIZE) {
    logger.warn("upload_file_too_large", { bufferLen: buffer.length });
    return Response.json(
      { error: "File size exceeds 10MB limit." },
      { status: 400 }
    );
  }

  const applicant = await getApplicantByToken(token);
  if (!applicant) {
    logger.warn("upload_token_not_found", { token: token?.substring(0, 8) });
    return Response.json({ error: "Invalid or expired session." }, { status: 400 });
  }
  if (String(applicant.paid ?? "").toUpperCase() === "TRUE") {
    logger.warn("upload_paid_applicant", { token: token?.substring(0, 8), applicantId: applicant.id });
    return Response.json({ error: "Application already completed." }, { status: 400 });
  }

  logger.info("upload_proceeding", {
    applicantId: applicant.id,
    docType,
    token: token?.substring(0, 8),
  });

  try {
    const drive = getDriveClient();
    const appsFolderId = process.env.GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID?.trim();
    if (!appsFolderId) throw new Error("GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID not configured");

    const folderName = `${applicant.firstName}_${applicant.lastName}`.replace(/[^a-zA-Z0-9]/g, "_");
    const applicantFolderId = await ensureFolderExists(drive, appsFolderId, folderName);
    const docFolderId = await ensureFolderExists(drive, applicantFolderId, docType);

    const ext = filename.split(".").pop() || "pdf";
    const randomFilename = `${crypto.randomUUID()}.${ext}`;

    logger.info("upload_attempt", {
      applicantId: applicant.id,
      docType,
      folderName,
      applicantFolderId,
      docFolderId,
      randomFilename,
      mimeType,
      bufferSize: buffer.length,
    });

    if (!verifyMagicBytes(buffer, mimeType)) {
      const detectedType = detectMimeTypeFromBytes(buffer);
      if (!detectedType || !ALLOWED_MIME_TYPES.includes(detectedType)) {
        logger.warn("file_type_mismatch", {
          applicantId: applicant.id,
          declared: mimeType,
          detected: detectedType,
          size: buffer.length,
        });
        return Response.json(
          { error: "File content does not match declared type. Only PDF, JPEG, PNG, GIF, or Word documents are allowed." },
          { status: 400 }
        );
      }
    }

    let driveFileId: string;
    try {
      const created = await drive.files.create({
        requestBody: { name: randomFilename, parents: [docFolderId] },
        media: { mimeType, body: Readable.from(buffer) },
        supportsAllDrives: true,
        fields: "id",
      });
      driveFileId = created.data.id;
      if (!driveFileId) throw new Error("Drive API returned no file ID");
      logger.info("drive_file_created", { applicantId: applicant.id, docType, driveFileId, randomFilename });
    } catch (driveError) {
      logger.error("drive_upload_failed", {
        applicantId: applicant.id,
        docType,
        error: driveError instanceof Error ? driveError.message : String(driveError),
      });
      throw driveError;
    }

    await addDriveFile(applicant.id, docType, filename, randomFilename);

    const counts = await getDriveFileCounts(applicant.id);
    const currentCount = counts[docType as DocType] || 1;
    await updateDocCount(applicant.id, docType, currentCount);

    logger.info("document_uploaded", {
      applicantId: applicant.id,
      docType,
      filename: randomFilename,
      size: buffer.length,
    });

    return Response.json({ success: true, docType, message: "Document uploaded successfully." });
  } catch (error) {
    Sentry.captureException(error, { extra: { applicantId: applicant.id, docType } });
    logger.error("document_upload_failed", {
      applicantId: applicant.id,
      docType,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return Response.json(
      { error: "Failed to upload document. Please try again." },
      { status: 500 }
    );
  }
};