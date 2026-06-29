import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetApplicantByToken,
  mockGetApplicantByEmail,
  mockCreateApplicantRow,
  mockUpdateApplicantFormData,
  mockMarkEmailVerified,
  mockValidateCompletion,
  mockSendResumeLink,
  mockGetSiteBaseUrl,
  mockListDriveFiles,
  mockCaptureException,
  mockCaptureMessage,
  mockLoggerInfo,
  mockLoggerError,
  mockLoggerWarn,
} = vi.hoisted(() => ({
  mockGetApplicantByToken: vi.fn(),
  mockGetApplicantByEmail: vi.fn(),
  mockCreateApplicantRow: vi.fn(),
  mockUpdateApplicantFormData: vi.fn(),
  mockMarkEmailVerified: vi.fn(),
  mockValidateCompletion: vi.fn(),
  mockSendResumeLink: vi.fn(),
  mockGetSiteBaseUrl: vi.fn(),
  mockListDriveFiles: vi.fn(),
  mockCaptureException: vi.fn(),
  mockCaptureMessage: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: mockCaptureException,
  captureMessage: mockCaptureMessage,
}));

vi.mock("../../../lib/upload-sheet", () => ({
  getApplicantByToken: mockGetApplicantByToken,
  getApplicantByEmail: mockGetApplicantByEmail,
  createApplicantRow: mockCreateApplicantRow,
  updateApplicantFormData: mockUpdateApplicantFormData,
  markEmailVerified: mockMarkEmailVerified,
  validateCompletion: mockValidateCompletion,
}));

vi.mock("../../../lib/email-sender", () => ({
  sendResumeLink: mockSendResumeLink,
}));

vi.mock("../../../lib/stripe-checkout", () => ({
  getSiteBaseUrl: mockGetSiteBaseUrl,
}));

vi.mock("../../../lib/drive-files", () => ({
  listDriveFiles: mockListDriveFiles,
}));

vi.mock("../../../lib/logger", () => ({
  logger: {
    info: mockLoggerInfo,
    error: mockLoggerError,
    warn: mockLoggerWarn,
  },
}));

import { POST } from "./apply";

const BASE_URL = "https://example.com/api/professional/apply";

function makeRequest(body: unknown): Request {
  return new Request(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/professional/apply — email verification gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSiteBaseUrl.mockReturnValue("https://example.com");
    mockCreateApplicantRow.mockResolvedValue(undefined);
    mockUpdateApplicantFormData.mockResolvedValue(undefined);
    mockMarkEmailVerified.mockResolvedValue(undefined);
    mockSendResumeLink.mockResolvedValue(undefined);
  });

  describe("new registration (no token, new email)", () => {
    it("creates a row, emails the resume link, returns requiresVerification, no token in body", async () => {
      mockGetApplicantByEmail.mockResolvedValue(null);

      const res = await POST({
        request: makeRequest({
          firstName: "Jane",
          lastName: "Doe",
          phone: "0271234567",
          email: "jane@example.com",
        }),
        url: new URL(BASE_URL),
      } as any);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.requiresVerification).toBe(true);
      expect(json.emailSent).toBe(true);
      // Critical: the response must NOT include the resume link or token.
      expect(json.resumeLink).toBeUndefined();
      expect(json.applicantId).toBeUndefined();
      expect(json.resumeToken).toBeUndefined();

      expect(mockCreateApplicantRow).toHaveBeenCalledTimes(1);
      const createArgs = mockCreateApplicantRow.mock.calls[0];
      // First six positional args: applicantId, firstName, lastName, phone, email, resumeToken.
      expect(createArgs[0]).toMatch(/^[0-9a-f-]{36}$/i); // applicantId is a UUID
      expect(createArgs[1]).toBe("Jane");
      expect(createArgs[4]).toBe("jane@example.com");
      expect(createArgs[5]).toMatch(/^[0-9a-f-]{36}$/i); // resumeToken is a UUID
      // The applicantId and resumeToken in the response must NOT be exposed.
      const createdToken = createArgs[5];

      expect(mockSendResumeLink).toHaveBeenCalledTimes(1);
      const sendArgs = mockSendResumeLink.mock.calls[0];
      expect(sendArgs[0]).toBe("jane@example.com");
      expect(sendArgs[1]).toBe("Jane Doe");
      expect(sendArgs[2]).toContain("/professional/apply?token=");
      expect(sendArgs[2]).toContain(createdToken);
    });

    it("does NOT pass an emailVerified arg explicitly (relies on the FALSE default)", async () => {
      // The default lives on createApplicantRow itself; apply.ts relies on it
      // rather than passing the value through. The actual write of "FALSE" to
      // row[46] is covered in upload-sheet.test.ts.
      mockGetApplicantByEmail.mockResolvedValue(null);
      await POST({
        request: makeRequest({
          firstName: "A",
          lastName: "B",
          email: "a@b.co",
        }),
        url: new URL(BASE_URL),
      } as any);

      const createArgs = mockCreateApplicantRow.mock.calls[0];
      // 33 positional args: 6 (identity) + 6 (about-you) + 4 (lists) + 8
      // (referees) + 9 (declarations incl. signed_at). The 34th (emailVerified)
      // is omitted and falls back to the default.
      expect(createArgs.length).toBe(33);
    });

    it("returns emailSent: false but still requiresVerification when sendResumeLink throws", async () => {
      mockGetApplicantByEmail.mockResolvedValue(null);
      mockSendResumeLink.mockRejectedValue(new Error("smtp down"));

      const res = await POST({
        request: makeRequest({
          firstName: "A",
          lastName: "B",
          email: "a@b.co",
        }),
        url: new URL(BASE_URL),
      } as any);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.requiresVerification).toBe(true);
      expect(json.emailSent).toBe(false);
      expect(mockCaptureMessage).toHaveBeenCalled();
    });

    it("returns 400 when first name is missing on new registration", async () => {
      mockGetApplicantByEmail.mockResolvedValue(null);
      const res = await POST({
        request: makeRequest({
          firstName: "",
          lastName: "Doe",
          email: "jane@example.com",
        }),
        url: new URL(BASE_URL),
      } as any);
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error).toContain("First name");
      expect(mockCreateApplicantRow).not.toHaveBeenCalled();
    });
  });

  describe("existing email, no token (resend path)", () => {
    const stored = {
      id: "app_stored",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      resumeToken: "stored-token-xyz",
      emailVerified: "TRUE",
    };

    it("resends the resume link to the stored email and returns requiresVerification with no token", async () => {
      mockGetApplicantByEmail.mockResolvedValue(stored);

      const res = await POST({
        request: makeRequest({
          firstName: "Different",
          lastName: "Name",
          email: "jane@example.com",
        }),
        url: new URL(BASE_URL),
      } as any);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.requiresVerification).toBe(true);
      expect(json.emailSent).toBe(true);
      // No token, no applicantId, no resumeLink in the response.
      expect(json.resumeLink).toBeUndefined();
      expect(json.applicantId).toBeUndefined();

      expect(mockSendResumeLink).toHaveBeenCalledTimes(1);
      // Always sent to the STORED email, not the submitted value.
      expect(mockSendResumeLink.mock.calls[0][0]).toBe("jane@example.com");
      // Stored full name, not the submitted one.
      expect(mockSendResumeLink.mock.calls[0][1]).toBe("Jane Doe");
      // Resume link uses the stored token.
      expect(mockSendResumeLink.mock.calls[0][2]).toBe(
        "https://example.com/professional/apply?token=stored-token-xyz"
      );
    });

    it("does NOT mutate the existing row (no updateApplicantFormData call)", async () => {
      mockGetApplicantByEmail.mockResolvedValue(stored);

      await POST({
        request: makeRequest({
          firstName: "Should",
          lastName: "BeIgnored",
          email: "jane@example.com",
        }),
        url: new URL(BASE_URL),
      } as any);

      expect(mockUpdateApplicantFormData).not.toHaveBeenCalled();
      expect(mockCreateApplicantRow).not.toHaveBeenCalled();
    });

    it("does NOT create a new row when one already exists for the email", async () => {
      mockGetApplicantByEmail.mockResolvedValue(stored);
      await POST({
        request: makeRequest({ firstName: "X", lastName: "Y", email: "jane@example.com" }),
        url: new URL(BASE_URL),
      } as any);
      expect(mockCreateApplicantRow).not.toHaveBeenCalled();
    });

    it("returns emailSent: false when the resend fails", async () => {
      mockGetApplicantByEmail.mockResolvedValue(stored);
      mockSendResumeLink.mockRejectedValue(new Error("smtp down"));

      const res = await POST({
        request: makeRequest({ firstName: "X", lastName: "Y", email: "jane@example.com" }),
        url: new URL(BASE_URL),
      } as any);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.requiresVerification).toBe(true);
      expect(json.emailSent).toBe(false);
      expect(json.emailError).toBe("smtp down");
      expect(mockCaptureMessage).toHaveBeenCalled();
    });
  });

  describe("email validation", () => {
    it("rejects an email without @ or .", async () => {
      const res = await POST({
        request: makeRequest({ firstName: "Jane", lastName: "Doe", email: "jane-example-com" }),
        url: new URL(BASE_URL),
      } as any);
      expect(res.status).toBe(400);
      expect(mockSendResumeLink).not.toHaveBeenCalled();
      expect(mockCreateApplicantRow).not.toHaveBeenCalled();
    });

    it("rejects an email with embedded CR (header injection)", async () => {
      const res = await POST({
        request: makeRequest({
          firstName: "Jane",
          lastName: "Doe",
          email: "jane@example.com\r\nBcc: attacker@evil.com",
        }),
        url: new URL(BASE_URL),
      } as any);
      expect(res.status).toBe(400);
      expect(mockSendResumeLink).not.toHaveBeenCalled();
      expect(mockCreateApplicantRow).not.toHaveBeenCalled();
    });

    it("rejects an email with embedded LF (header injection)", async () => {
      const res = await POST({
        request: makeRequest({
          firstName: "Jane",
          lastName: "Doe",
          email: "jane@example.com\nBcc: attacker@evil.com",
        }),
        url: new URL(BASE_URL),
      } as any);
      expect(res.status).toBe(400);
    });
  });

  describe("token-bearing path (existing behavior kept)", () => {
    it("updates form data and returns resume link, applicantId, existing:true", async () => {
      const stored = {
        id: "app_stored",
        email: "jane@example.com",
        firstName: "Jane",
        lastName: "Doe",
        resumeToken: "tok-abc",
        emailVerified: "TRUE",
      };
      mockGetApplicantByToken.mockResolvedValue(stored);

      const res = await POST({
        request: makeRequest({
          token: "tok-abc",
          firstName: "Jane",
          lastName: "Doe",
          email: "jane@example.com",
          phone: "0271234567",
        }),
        url: new URL(BASE_URL),
      } as any);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.applicantId).toBe("app_stored");
      expect(json.existing).toBe(true);
      expect(json.resumeLink).toBe("https://example.com/professional/apply?token=tok-abc");
      expect(json.requiresVerification).toBeUndefined();
      expect(mockUpdateApplicantFormData).toHaveBeenCalledWith(
        "app_stored",
        expect.objectContaining({ firstName: "Jane", lastName: "Doe" })
      );
    });

    it("returns 404 when the token does not match any applicant", async () => {
      mockGetApplicantByToken.mockResolvedValue(null);
      const res = await POST({
        request: makeRequest({ token: "missing", firstName: "A", lastName: "B", email: "a@b.co" }),
        url: new URL(BASE_URL),
      } as any);
      expect(res.status).toBe(404);
      expect(mockUpdateApplicantFormData).not.toHaveBeenCalled();
    });
  });

  it("returns 400 when neither token nor email is provided", async () => {
    const res = await POST({
      request: makeRequest({ firstName: "A", lastName: "B" }),
      url: new URL(BASE_URL),
    } as any);
    expect(res.status).toBe(400);
    expect(mockCreateApplicantRow).not.toHaveBeenCalled();
    expect(mockSendResumeLink).not.toHaveBeenCalled();
  });
});
