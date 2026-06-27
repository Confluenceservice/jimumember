import { beforeEach, describe, expect, it, vi } from "vitest";
const {
  mockCaptureException,
  mockGetApplicantByToken,
  mockUpdateDocCount,
  mockAddDriveFile,
  mockGetDriveFileCounts,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
  mockDriveFilesList,
  mockDriveFilesCreate,
  mockDriveFactory,
  mockJWT,
} = vi.hoisted(() => ({
  mockCaptureException: vi.fn(),
  mockGetApplicantByToken: vi.fn(),
  mockUpdateDocCount: vi.fn(),
  mockAddDriveFile: vi.fn(),
  mockGetDriveFileCounts: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
  mockDriveFilesList: vi.fn(),
  mockDriveFilesCreate: vi.fn(),
  mockDriveFactory: vi.fn(() => ({
    files: {
      list: vi.fn(),
      create: vi.fn(),
    },
  })),
  mockJWT: vi.fn(),
}));

mockDriveFactory.mockImplementation(() => ({
  files: {
    list: mockDriveFilesList,
    create: mockDriveFilesCreate,
  },
}));
vi.mock("@sentry/node", () => ({
  captureException: mockCaptureException,
}));
vi.mock("../../../lib/upload-sheet", () => ({
  REQUIRED_DOC_TYPES: ["training", "ethics", "criminal", "advance_care", "assisted_dying", "fundamentals"],
  getApplicantByToken: mockGetApplicantByToken,
  updateDocCount: mockUpdateDocCount,
}));
vi.mock("../../../lib/drive-files", () => ({
  addDriveFile: mockAddDriveFile,
  getDriveFileCounts: mockGetDriveFileCounts,
}));
vi.mock("../../../lib/logger", () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  },
}));
vi.mock("googleapis", () => ({
  google: {
    auth: {
      JWT: mockJWT,
    },
    drive: mockDriveFactory,
  },
}));


import { POST } from "./upload-file";

function makeMultipartRequest(file: File, token = "token-123", docType = "training") {
  const formData = new FormData();
  formData.append("token", token);
  formData.append("docType", docType);
  formData.append("file", file, file.name);
  return new Request("http://localhost/api/professional/upload-file", {
    method: "POST",
    body: formData,
  });
}

function makeBinaryRequest(
  bytes: Buffer,
  {
    token = "token-123",
    docType = "training",
    filename = "scan.pdf",
    mimeType = "application/octet-stream",
  }: {
    token?: string;
    docType?: string;
    filename?: string;
    mimeType?: string;
  } = {}
) {
  return new Request("http://localhost/api/professional/upload-file", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-upload-token": token,
      "x-upload-doc-type": docType,
      "x-upload-filename": encodeURIComponent(filename),
      "x-upload-mime-type": mimeType,
    },
    body: new Uint8Array(bytes),
  });
}

function seedSuccessfulDriveCalls(finalFileId = "drive-file-123") {
  // PM Applications folder (list→create), applicant folder (list→create), doc folder (list→create), file
  mockDriveFilesList
    .mockResolvedValueOnce({ data: { files: [] } }) // PM Applications not found
    .mockResolvedValueOnce({ data: { files: [] } }) // applicant folder not found
    .mockResolvedValueOnce({ data: { files: [] } }); // doc folder not found

  mockDriveFilesCreate
    .mockResolvedValueOnce({ data: { id: "pm-applications-folder-id" } })
    .mockResolvedValueOnce({ data: { id: "applicant-folder-id" } })
    .mockResolvedValueOnce({ data: { id: "doc-folder-id" } })
    .mockResolvedValueOnce({ data: { id: finalFileId } });
}

function seedFolderCreationCalls() {
  // PM Applications folder (list→create), applicant folder (list→create), doc folder (list→create)
  mockDriveFilesList
    .mockResolvedValueOnce({ data: { files: [] } }) // PM Applications not found
    .mockResolvedValueOnce({ data: { files: [] } }) // applicant folder not found
    .mockResolvedValueOnce({ data: { files: [] } }); // doc folder not found

  mockDriveFilesCreate
    .mockResolvedValueOnce({ data: { id: "pm-applications-folder-id" } })
    .mockResolvedValueOnce({ data: { id: "applicant-folder-id" } })
    .mockResolvedValueOnce({ data: { id: "doc-folder-id" } });
}

describe("POST /api/professional/upload-file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL = "svc@example.iam.gserviceaccount.com";
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY = "-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n";
    process.env.GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID = "apps-folder-id";

    mockGetApplicantByToken.mockResolvedValue({
      id: "applicant-1",
      firstName: "Jane",
      lastName: "Doe",
      paid: "FALSE",
    });
    mockGetDriveFileCounts.mockResolvedValue({ training: 1 });
    mockUpdateDocCount.mockResolvedValue(undefined);
    mockAddDriveFile.mockResolvedValue(undefined);
  });

  it("uploads a valid multipart PDF successfully", async () => {
    seedSuccessfulDriveCalls("uploaded-drive-file-id");
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const file = new File([pdfBytes], "certificate.pdf", { type: "application/pdf" });
    const request = makeMultipartRequest(file);

    const response = await POST({ request } as any);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.docType).toBe("training");
    expect(json.originalFilename).toBe("certificate.pdf");
    expect(json.fileId).toMatch(/\.pdf$/);
    expect(json.uploadedAt).toBeTypeOf("string");

    expect(mockAddDriveFile).toHaveBeenCalledWith(
      "applicant-1",
      "training",
      "certificate.pdf",
      expect.stringMatching(/\.pdf$/)
    );
    expect(mockUpdateDocCount).toHaveBeenCalledWith("applicant-1", "training", 1);
  });

  it("accepts application/octet-stream when magic bytes detect a supported file type", async () => {
    seedSuccessfulDriveCalls("uploaded-drive-file-id");
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const request = makeBinaryRequest(pdfBytes, {
      filename: "scan.pdf",
      mimeType: "application/octet-stream",
    });

    const response = await POST({ request } as any);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);

    const uploadCall = mockDriveFilesCreate.mock.calls.find(([arg]) => arg.media)?.[0];
    expect(uploadCall).toBeDefined();
    expect(uploadCall.media.mimeType).toBe("application/pdf");
  });

  it("rejects file content that does not match declared MIME type", async () => {
    seedFolderCreationCalls();
    const badBytes = Buffer.from("not-a-real-pdf-file");
    const file = new File([badBytes], "fake.pdf", { type: "application/pdf" });
    const request = makeMultipartRequest(file);

    const response = await POST({ request } as any);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("File content does not match declared type");
    expect(mockDriveFilesCreate).toHaveBeenCalledTimes(3);
    expect(mockAddDriveFile).not.toHaveBeenCalled();
  });

  it("rejects files larger than 50MB", async () => {
    const largePdfLikeBytes = Buffer.alloc(50 * 1024 * 1024 + 1);
    largePdfLikeBytes[0] = 0x25;
    largePdfLikeBytes[1] = 0x50;
    largePdfLikeBytes[2] = 0x44;
    largePdfLikeBytes[3] = 0x46;
    const file = new File([largePdfLikeBytes], "huge.pdf", { type: "application/pdf" });
    const request = makeMultipartRequest(file);

    const response = await POST({ request } as any);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("50MB limit");
    expect(mockGetApplicantByToken).not.toHaveBeenCalled();
    expect(mockDriveFilesCreate).not.toHaveBeenCalled();
  });
});
