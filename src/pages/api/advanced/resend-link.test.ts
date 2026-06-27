import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetApplicantByToken,
  mockSendResumeLink,
  mockCaptureException,
  mockLoggerInfo,
  mockLoggerError,
  mockGetSiteBaseUrl,
} = vi.hoisted(() => ({
  mockGetApplicantByToken: vi.fn(),
  mockSendResumeLink: vi.fn(),
  mockCaptureException: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
  mockGetSiteBaseUrl: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: mockCaptureException,
}));

vi.mock("../../../lib/upload-sheet", () => ({
  getApplicantByToken: mockGetApplicantByToken,
}));

vi.mock("../../../lib/email-sender", () => ({
  sendResumeLink: mockSendResumeLink,
}));

vi.mock("../../../lib/logger", () => ({
  logger: {
    info: mockLoggerInfo,
    error: mockLoggerError,
  },
}));

vi.mock("../../../lib/stripe-checkout", () => ({
  getSiteBaseUrl: mockGetSiteBaseUrl,
}));

import { POST } from "./resend-link";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/professional/resend-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/professional/resend-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSiteBaseUrl.mockReturnValue("https://example.com");
  });

  it("resends the resume link to the applicant's email", async () => {
    mockGetApplicantByToken.mockResolvedValue({
      id: "applicant-1",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
    });
    mockSendResumeLink.mockResolvedValue(undefined);

    const res = await POST({
      request: makeRequest({ token: "abc-token" }),
      url: new URL("https://example.com/api/professional/resend-link"),
    } as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.emailSent).toBe(true);
    expect(json.resumeLink).toBe("https://example.com/professional/apply?token=abc-token");
    expect(mockSendResumeLink).toHaveBeenCalledWith(
      "jane@example.com",
      "Jane Doe",
      "https://example.com/professional/apply?token=abc-token",
      "applicant-1"
    );
  });

  it("rejects an empty token", async () => {
    const res = await POST({
      request: makeRequest({ token: "" }),
      url: new URL("https://example.com/api/professional/resend-link"),
    } as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("Token is required");
    expect(mockSendResumeLink).not.toHaveBeenCalled();
  });

  it("returns 404 when the token does not match any applicant", async () => {
    mockGetApplicantByToken.mockResolvedValue(null);
    const res = await POST({
      request: makeRequest({ token: "missing" }),
      url: new URL("https://example.com/api/professional/resend-link"),
    } as any);
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toContain("Invalid or expired");
    expect(mockSendResumeLink).not.toHaveBeenCalled();
  });

  it("returns 400 when the applicant has no email on file", async () => {
    mockGetApplicantByToken.mockResolvedValue({
      id: "applicant-2",
      firstName: "John",
      lastName: "Smith",
      email: "",
    });
    const res = await POST({
      request: makeRequest({ token: "abc" }),
      url: new URL("https://example.com/api/professional/resend-link"),
    } as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("No email on file");
    expect(mockSendResumeLink).not.toHaveBeenCalled();
  });

  it("returns 500 and surfaces the resume link when sendEmail fails", async () => {
    mockGetApplicantByToken.mockResolvedValue({
      id: "applicant-3",
      firstName: "Kim",
      lastName: "Lee",
      email: "kim@example.com",
    });
    mockSendResumeLink.mockRejectedValue(new Error("smtp down"));

    const res = await POST({
      request: makeRequest({ token: "abc-token" }),
      url: new URL("https://example.com/api/professional/resend-link"),
    } as any);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain("Could not send");
    expect(json.resumeLink).toBe("https://example.com/professional/apply?token=abc-token");
    expect(mockCaptureException).toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON payload", async () => {
    const req = new Request("http://localhost/api/professional/resend-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST({ request: req, url: new URL("http://localhost/api/professional/resend-link") } as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid JSON");
    expect(mockGetApplicantByToken).not.toHaveBeenCalled();
  });
});
