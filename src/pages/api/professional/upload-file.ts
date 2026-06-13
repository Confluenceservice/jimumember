import type { APIRoute } from "astro";
import crypto from "node:crypto";
import * as Sentry from "@sentry/node";
import { getApplicantByToken, updateDocCount, REQUIRED_DOC_TYPES, type DocType } from "../../../lib/upload-sheet";
import { addDriveFile, getDriveFileCounts } from "../../../lib/drive-files";
import { google } from "googleapis";
import { logger } from "../../../lib/logger";
import { getServiceAccountJwtAuth } from "../../../lib/google-auth";
import { getStagingPrefix } from "../../../lib/staging";
import { Readable } from "node:stream";

interface GoogleApiErrorDetail {
  message?: string;
  reason?: string;
  domain?: string;
  location?: string;
  locationType?: string;
}

function tokenPrefix(token?: string): string | undefined {
  if (!token) return undefined;
  return token.substring(0, 8);
}

function extractErrorMeta(error: unknown): Record<string, unknown> {
  const err = error as {
    name?: string;
    message?: string;
    stack?: string;
    code?: string | number;
    errors?: GoogleApiErrorDetail[];
    response?: {
      status?: number;
      data?: {
        error?: {
          code?: number;
          message?: string;
          status?: string;
          errors?: GoogleApiErrorDetail[];
        };
      };
    };
    config?: {
      method?: string;
      url?: string;
    };
  };

  const apiError = err?.response?.data?.error;
  const firstApiError = apiError?.errors?.[0];
  const firstTopLevelError = err?.errors?.[0];

  return {
    errorName: err?.name,
    errorMessage: err?.message ?? String(error),
    errorCode: err?.code,
    errorStack: typeof err?.stack === "string" ? err.stack.split("\n")[0] : undefined,
    httpStatus: err?.response?.status,
    apiErrorCode: apiError?.code,
    apiErrorMessage: apiError?.message,
    apiErrorStatus: apiError?.status,
    apiErrorReason: firstApiError?.reason ?? firstTopLevelError?.reason,
    apiErrorDomain: firstApiError?.domain ?? firstTopLevelError?.domain,
    apiErrorLocation: firstApiError?.location,
    apiErrorLocationType: firstApiError?.locationType,
    upstreamMethod: err?.config?.method,
    upstreamUrl: err?.config?.url,
  };
}

function getDriveClient() {
  const auth = getServiceAccountJwtAuth(["https://www.googleapis.com/auth/drive"]);
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
const GENERIC_MIME_TYPES = [
  "",
  "application/octet-stream",
  "binary/octet-stream",
];

const DEFAULT_MAX_FILE_SIZE_MB = 50;
const parsedMaxFileSizeMb = Number(process.env.PROFESSIONAL_UPLOAD_MAX_MB ?? DEFAULT_MAX_FILE_SIZE_MB);
const MAX_FILE_SIZE_MB = Number.isFinite(parsedMaxFileSizeMb) && parsedMaxFileSizeMb > 0
  ? parsedMaxFileSizeMb
  : DEFAULT_MAX_FILE_SIZE_MB;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

// Per-applicant upload queue. Serialises concurrent uploads for the same
// applicant so the read-modify-write sequence in the handler
// (getDriveFileCounts -> addDriveFile -> updateDocCount) cannot race and
// produce a stale doc count. Mirrors the applicantSaveQueues pattern in
// apply.ts.
const applicantUploadQueues = new Map<string, Promise<unknown>>();
async function queueApplicantUpload<T>(
  applicantId: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = applicantUploadQueues.get(applicantId) ?? Promise.resolve();
  const current: Promise<T> = previous
    .catch(() => {})
    .then(() => operation());
  const tracked: Promise<unknown> = current.then(
    () => undefined,
    () => undefined,
  );
  tracked.finally(() => {
    if (applicantUploadQueues.get(applicantId) === tracked) {
      applicantUploadQueues.delete(applicantId);
    }
  });
  applicantUploadQueues.set(applicantId, tracked);
  return current;
}

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

function decodeFilename(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
  const uploadRequestId = crypto.randomUUID();
  const requestLogger = typeof logger.child === "function"
    ? logger.child({
      route: "/api/professional/upload-file",
      uploadRequestId,
    })
    : logger;
  const contentType = request.headers.get("content-type") || "";
  const contentLength = request.headers.get("content-length");
  let stage = "request_received";
  let token = "";
  let docType = "";
  let filename = "";
  let mimeType = "";
  let buffer = Buffer.alloc(0);
  const respond = (status: number, body: Record<string, unknown>) =>
    Response.json({ requestId: uploadRequestId, ...body }, { status });

  requestLogger.info("upload_request_received", { contentType, contentLength });

  if (contentType.includes("application/json")) {
    stage = "parse_json_payload";
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      requestLogger.warn("upload_invalid_json_payload", { stage });
      return respond(400, { code: "INVALID_JSON_PAYLOAD", error: "Invalid JSON payload." });
    }

    token = (payload.token as string)?.trim() || "";
    docType = (payload.docType as string)?.trim() || "";
    filename = (payload.filename as string)?.trim() || "";
    mimeType = (payload.mimeType as string)?.trim() || "";
    const base64Data = payload.data as string;

    if (typeof base64Data !== "string" || base64Data.length === 0) {
      requestLogger.warn("upload_missing_base64_data", {
        stage,
        tokenPrefix: tokenPrefix(token),
        docType,
      });
      return respond(400, { code: "MISSING_FILE_DATA", error: "File data is required." });
    }

    try {
      buffer = Buffer.from(base64Data, "base64");
    } catch {
      requestLogger.warn("upload_invalid_base64_data", {
        stage,
        tokenPrefix: tokenPrefix(token),
        docType,
      });
      return respond(400, { code: "INVALID_BASE64_DATA", error: "Invalid base64 data." });
    }

    requestLogger.info("upload_payload_parsed", {
      stage,
      mode: "json",
      tokenPrefix: tokenPrefix(token),
      docType,
      filename,
      mimeType,
      bufferLen: buffer.length,
    });
  } else if (contentType.includes("application/octet-stream")) {
    stage = "parse_binary_payload";
    token = request.headers.get("x-upload-token")?.trim() ?? "";
    docType = request.headers.get("x-upload-doc-type")?.trim() ?? "";
    filename = decodeFilename(request.headers.get("x-upload-filename")?.trim() ?? "");
    mimeType = request.headers.get("x-upload-mime-type")?.trim() || "application/octet-stream";
    const arrayBuffer = await request.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);

    requestLogger.info("upload_payload_parsed", {
      stage,
      mode: "binary",
      tokenPrefix: tokenPrefix(token),
      docType,
      filename,
      mimeType,
      bufferLen: buffer.length,
    });
  } else if (contentType.includes("multipart/form-data")) {
    stage = "parse_multipart_payload";
    const formData = await request.formData();
    token = (formData.get("token") as string)?.trim() ?? "";
    docType = (formData.get("docType") as string)?.trim() ?? "";
    const file = formData.get("file") as File | null;

    if (!file) {
      requestLogger.warn("upload_missing_file", {
        stage,
        mode: "multipart",
        tokenPrefix: tokenPrefix(token),
        docType,
      });
      return respond(400, { code: "MISSING_FILE", error: "File is required." });
    }

    filename = file.name;
    mimeType = file.type;
    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    requestLogger.info("upload_payload_parsed", {
      stage,
      mode: "multipart",
      tokenPrefix: tokenPrefix(token),
      docType,
      filename,
      mimeType,
      bufferLen: buffer.length,
    });
  } else {
    requestLogger.warn("upload_bad_content_type", { stage, contentType });
    return respond(400, {
      code: "UNSUPPORTED_CONTENT_TYPE",
      error: "Content-Type must be application/json, application/octet-stream, or multipart/form-data.",
    });
  }

  stage = "validate_payload";
  if (!token) {
    requestLogger.warn("upload_missing_token", {
      stage,
      contentType,
      docType,
      filename,
    });
    return respond(400, { code: "MISSING_TOKEN", error: "Token is required." });
  }
  if (!docType) {
    requestLogger.warn("upload_missing_doctype", {
      stage,
      tokenPrefix: tokenPrefix(token),
      filename,
    });
    return respond(400, { code: "MISSING_DOC_TYPE", error: "Document type is required." });
  }
  if (!filename) {
    requestLogger.warn("upload_missing_filename", {
      stage,
      tokenPrefix: tokenPrefix(token),
      docType,
    });
    return respond(400, { code: "MISSING_FILENAME", error: "File name is required." });
  }

  const allDocTypes = [...REQUIRED_DOC_TYPES, "insurance"] as const;
  if (!allDocTypes.includes(docType as typeof allDocTypes[number])) {
    requestLogger.warn("upload_bad_doctype", {
      stage,
      tokenPrefix: tokenPrefix(token),
      docType,
      filename,
    });
    return respond(400, { code: "INVALID_DOC_TYPE", error: "Valid document type is required." });
  }

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    const detectedType = detectMimeTypeFromBytes(buffer);
    if (detectedType && ALLOWED_MIME_TYPES.includes(detectedType) && GENERIC_MIME_TYPES.includes(mimeType)) {
      requestLogger.info("upload_mimetype_inferred", {
        stage,
        tokenPrefix: tokenPrefix(token),
        docType,
        filename,
        providedMimeType: mimeType,
        detectedType,
      });
      mimeType = detectedType;
    } else {
      requestLogger.warn("upload_bad_mimetype", {
        stage,
        tokenPrefix: tokenPrefix(token),
        docType,
        filename,
        mimeType,
        detectedType,
      });
      return respond(400, {
        code: "UNSUPPORTED_MIME_TYPE",
        error: "File type not allowed. Use PDF, JPEG, PNG, GIF, or Word documents.",
      });
    }
  }

  if (buffer.length > MAX_FILE_SIZE) {
    requestLogger.warn("upload_file_too_large", {
      stage,
      tokenPrefix: tokenPrefix(token),
      docType,
      filename,
      bufferLen: buffer.length,
      maxFileSizeMb: MAX_FILE_SIZE_MB,
      maxFileSizeBytes: MAX_FILE_SIZE,
    });
    return respond(400, {
      code: "FILE_TOO_LARGE",
      error: `File size exceeds ${MAX_FILE_SIZE_MB}MB limit.`,
      maxFileSizeMb: MAX_FILE_SIZE_MB,
      maxFileSizeBytes: MAX_FILE_SIZE,
    });
  }

  stage = "resolve_applicant";
  const applicant = await getApplicantByToken(token);
  if (!applicant) {
    requestLogger.warn("upload_token_not_found", {
      stage,
      tokenPrefix: tokenPrefix(token),
      docType,
      filename,
    });
    return respond(400, { code: "INVALID_SESSION", error: "Invalid or expired session." });
  }
  if (String(applicant.paid ?? "").toUpperCase() === "TRUE") {
    requestLogger.warn("upload_paid_applicant", {
      stage,
      tokenPrefix: tokenPrefix(token),
      applicantId: applicant.id,
      docType,
      filename,
    });
    return respond(400, { code: "APPLICATION_COMPLETED", error: "Application already completed." });
  }

  requestLogger.info("upload_proceeding", {
    stage,
    applicantId: applicant.id,
    docType,
    tokenPrefix: tokenPrefix(token),
    filename,
    mimeType,
    bufferSize: buffer.length,
  });

  // Per-applicant serialisation. The full handler (Drive upload + sheet
  // writes + count refresh) runs inside this queue so concurrent uploads
  // for the same applicant never overlap. Different applicants still run
  // in parallel.
  return queueApplicantUpload(applicant.id, async () => {
    try {
      stage = "init_drive_client";
      const drive = getDriveClient();
      stage = "load_drive_root_folder";
      const appsFolderId = process.env.GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID?.trim();
      if (!appsFolderId) throw new Error("GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID not configured");

      stage = "ensure_pm_applications_folder";
      const pmFolderId = await ensureFolderExists(drive, appsFolderId, `${getStagingPrefix()}PM Applications`);

      stage = "ensure_applicant_folder";
      const folderName = `${applicant.firstName}_${applicant.lastName}`.replace(/[^a-zA-Z0-9]/g, "_");
      const applicantFolderId = await ensureFolderExists(drive, pmFolderId, folderName);
      stage = "ensure_doc_folder";
      const docFolderId = await ensureFolderExists(drive, applicantFolderId, docType);

      const ext = filename.split(".").pop() || "pdf";
      const randomFilename = `${crypto.randomUUID()}.${ext}`;

      requestLogger.info("upload_attempt", {
        stage: "ready_for_drive_upload",
        applicantId: applicant.id,
        docType,
        folderName,
        applicantFolderId,
        docFolderId,
        randomFilename,
        mimeType,
        bufferSize: buffer.length,
      });

      stage = "verify_magic_bytes";
      if (!verifyMagicBytes(buffer, mimeType)) {
        const detectedType = detectMimeTypeFromBytes(buffer);
        if (!detectedType || !ALLOWED_MIME_TYPES.includes(detectedType)) {
          requestLogger.warn("upload_file_type_mismatch", {
            stage,
            applicantId: applicant.id,
            tokenPrefix: tokenPrefix(token),
            docType,
            filename,
            declared: mimeType,
            detected: detectedType,
            size: buffer.length,
          });
          return respond(400, {
            code: "FILE_SIGNATURE_MISMATCH",
            error: "File content does not match declared type. Only PDF, JPEG, PNG, GIF, or Word documents are allowed.",
          });
        }
      }

      stage = "upload_to_drive";
      const created = await drive.files.create({
        requestBody: { name: randomFilename, parents: [docFolderId] },
        media: { mimeType, body: Readable.from(buffer) },
        supportsAllDrives: true,
        fields: "id",
      });
      const createdFileId = created.data.id;
      if (!createdFileId) throw new Error("Drive API returned no file ID");
      const driveFileId = createdFileId;
      requestLogger.info("drive_file_created", {
        stage,
        applicantId: applicant.id,
        docType,
        driveFileId,
        randomFilename,
      });

      const uploadedAt = new Date().toISOString();
      stage = "persist_drive_file_record";
      await addDriveFile(applicant.id, docType, filename, randomFilename);

      stage = "refresh_doc_counts";
      const counts = await getDriveFileCounts(applicant.id);
      const currentCount = counts[docType as DocType] || 1;
      stage = "update_doc_count";
      await updateDocCount(applicant.id, docType, currentCount);

      requestLogger.info("document_uploaded", {
        stage: "completed",
        applicantId: applicant.id,
        docType,
        filename: randomFilename,
        driveFileId,
        size: buffer.length,
        uploadedAt,
        currentCount,
      });

      return respond(200, {
        success: true,
        docType,
        fileId: randomFilename,
        originalFilename: filename,
        uploadedAt,
        message: "Document uploaded successfully.",
      });
    } catch (error) {
      const errorMeta = extractErrorMeta(error);
      Sentry.captureException(error, {
        extra: {
          uploadRequestId,
          stage,
          applicantId: applicant.id,
          docType,
          tokenPrefix: tokenPrefix(token),
          filename,
          mimeType,
          bufferSize: buffer.length,
          ...errorMeta,
        },
      });
      requestLogger.error("document_upload_failed", {
        stage,
        applicantId: applicant.id,
        docType,
        tokenPrefix: tokenPrefix(token),
        filename,
        mimeType,
        bufferSize: buffer.length,
        ...errorMeta,
      });
      return respond(500, {
        code: "UPLOAD_INTERNAL_ERROR",
        error: "Failed to upload document. Please try again.",
      });
    }
  });
};
