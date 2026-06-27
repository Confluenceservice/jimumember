import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mocks — must come before the module under test imports them.
const { mockMessagesCreate, mockAppendEmailLog } = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
  mockAppendEmailLog: vi.fn(),
}));

vi.mock("mailgun.js", () => {
  class Mailgun {
    client() {
      return { messages: { create: mockMessagesCreate } };
    }
  }
  return { default: Mailgun };
});

vi.mock("./google-sheets", () => ({
  appendEmailLog: mockAppendEmailLog,
}));

import {
  sendEmail,
  sendAdvancedConfirmation,
  sendBasicConfirmation,
  sendAdvancedApplicationNotification,
  sendBasicApplicationNotification,
  sendResumeLink,
} from "./email-sender";

const ORIGINAL_ENV = { ...process.env };

function setMailgunEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  process.env.MAILGUN_API_KEY = "key-test";
  process.env.MAILGUN_DOMAIN = "mg.example.com";
  process.env.MAILGUN_FROM = "Re:Member <no-reply@mg.example.com>";
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  setMailgunEnv();
  mockMessagesCreate.mockResolvedValue({ id: "<msg-id@mailgun.org>" });
  mockAppendEmailLog.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ---------------------------------------------------------------------------
// sendEmail — env, transport, audit log
// ---------------------------------------------------------------------------

describe("sendEmail", () => {
  it("posts to Mailgun with from, to, subject, text", async () => {
    await sendEmail(
      { to: "a@b.com", subject: "Hello", body: "World" },
      { template: "resume_link", applicantId: "app-1" },
    );

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      "mg.example.com",
      expect.objectContaining({
        from: "Re:Member <no-reply@mg.example.com>",
        to: ["a@b.com"],
        subject: "Hello",
        text: "World",
      }),
    );
  });

  it("passes Reply-To via h:Reply-To header when replyTo is set", async () => {
    await sendEmail(
      { to: "a@b.com", subject: "S", body: "B", replyTo: "help@example.com" },
      { template: "resume_link" },
    );

    const call = mockMessagesCreate.mock.calls[0][1];
    expect(call["h:Reply-To"]).toBe("help@example.com");
  });

  it("omits h:Reply-To when not set", async () => {
    await sendEmail({ to: "a@b.com", subject: "S", body: "B" }, { template: "resume_link" });

    const call = mockMessagesCreate.mock.calls[0][1];
    expect(call).not.toHaveProperty("h:Reply-To");
  });

  it("does not prefix the subject in production-like env (no STAGING_PREFIX)", async () => {
    delete process.env.STAGING_PREFIX;
    await sendEmail(
      { to: "a@b.com", subject: "Hello", body: "World" },
      { template: "resume_link" },
    );
    expect(mockMessagesCreate.mock.calls[0][1].subject).toBe("Hello");
    expect(mockAppendEmailLog.mock.calls[0][0].subject).toBe("Hello");
  });

  it("prefixes the subject with [TESTING] when STAGING_PREFIX is set", async () => {
    process.env.STAGING_PREFIX = "testing-";
    await sendEmail(
      { to: "a@b.com", subject: "Hello", body: "World" },
      { template: "resume_link" },
    );
    expect(mockMessagesCreate.mock.calls[0][1].subject).toBe("[TESTING] Hello");
    expect(mockAppendEmailLog.mock.calls[0][0].subject).toBe("[TESTING] Hello");
  });

  it("treats an empty STAGING_PREFIX as production (no prefix)", async () => {
    process.env.STAGING_PREFIX = "   ";
    await sendEmail(
      { to: "a@b.com", subject: "Hi", body: "B" },
      { template: "resume_link" },
    );
    expect(mockMessagesCreate.mock.calls[0][1].subject).toBe("Hi");
  });

  it("logs success to the email audit sheet", async () => {
    await sendEmail(
      { to: "a@b.com", subject: "Hi", body: "Body" },
      { template: "resume_link", applicantId: "app-1" },
    );
    expect(mockAppendEmailLog).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@b.com",
        subject: "Hi",
        template: "resume_link",
        applicantId: "app-1",
        result: "sent",
      }),
    );
  });

  it("logs failure to the email audit sheet and rethrows", async () => {
    mockMessagesCreate.mockRejectedValue(new Error("401 unauthorized"));

    await expect(
      sendEmail(
        { to: "a@b.com", subject: "S", body: "B" },
        { template: "resume_link", applicantId: "app-2" },
      ),
    ).rejects.toThrow("401 unauthorized");

    expect(mockAppendEmailLog).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@b.com",
        template: "resume_link",
        applicantId: "app-2",
        result: "failed",
        error: expect.stringContaining("401 unauthorized"),
      }),
    );
  });

  it("throws when MAILGUN_API_KEY is missing", async () => {
    delete process.env.MAILGUN_API_KEY;
    await expect(
      sendEmail({ to: "a@b.com", subject: "S", body: "B" }, { template: "resume_link" }),
    ).rejects.toThrow(/MAILGUN_API_KEY/);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("throws when MAILGUN_DOMAIN is missing", async () => {
    delete process.env.MAILGUN_DOMAIN;
    await expect(
      sendEmail({ to: "a@b.com", subject: "S", body: "B" }, { template: "resume_link" }),
    ).rejects.toThrow(/MAILGUN_DOMAIN/);
  });

  it("throws when MAILGUN_FROM is missing", async () => {
    delete process.env.MAILGUN_FROM;
    await expect(
      sendEmail({ to: "a@b.com", subject: "S", body: "B" }, { template: "resume_link" }),
    ).rejects.toThrow(/MAILGUN_FROM/);
  });
});

// ---------------------------------------------------------------------------
// Template content — high-level senders
// ---------------------------------------------------------------------------

async function captureBody(template: "advanced" | "basic" | "basicNotListed" | "applicationNotification" | "basicApplicationNotification" | "resume") {
  await (
    {
      advanced: () => sendAdvancedConfirmation("jane@example.com", "Jane Doe"),
      basic: () => sendBasicConfirmation("bob@example.com", "Bob Smith", true),
      basicNotListed: () => sendBasicConfirmation("bob@example.com", "Bob Smith", false),
      applicationNotification: () =>
        sendAdvancedApplicationNotification("membership@example.com", "Jane Doe", "https://docs.google.com/document/d/abc"),
      basicApplicationNotification: () =>
        sendBasicApplicationNotification("membership@example.com", "Bob Smith", "https://docs.google.com/document/d/xyz"),
      resume: () => sendResumeLink("jane@example.com", "Jane Doe", "https://example.com/resume/abc123"),
    }[template]()
  );

  const call = mockMessagesCreate.mock.calls.at(-1);
  if (!call) throw new Error("no Mailgun call captured");
  return { to: call[1].to[0], subject: call[1].subject, text: call[1].text as string, replyTo: call[1]["h:Reply-To"] as string | undefined };
}

describe("sendAdvancedConfirmation", () => {
  it("addresses the applicant by full name and includes the right subject", async () => {
    const { to, subject, text } = await captureBody("advanced");
    expect(to).toBe("jane@example.com");
    expect(subject).toBe("Your Re:Member Advanced Membership Application");
    expect(text).toContain("Dear Jane Doe");
    expect(text).toContain("Advanced Member of Re:Member");
    expect(text).toContain("The Re:Member Committee");
  });
});

describe("sendBasicConfirmation", () => {
  it("includes the listing note when listOnPage is true and sets Reply-To", async () => {
    const { text, replyTo } = await captureBody("basic");
    expect(text).toContain("You have requested to be listed on our Basic Member list");
    expect(replyTo).toBe("membership@example.com");
  });

  it("includes the non-listing note when listOnPage is false", async () => {
    const { text } = await captureBody("basicNotListed");
    expect(text).toContain("You have not requested to be listed at this time");
    expect(text).toContain("membership@example.com");
  });

  it("includes member resources, meetings, and welcome content", async () => {
    const { text } = await captureBody("basicNotListed");
    expect(text).toContain("Basic Member Resources");
    expect(text).toContain("Meetings");
    expect(text).toContain("Networking");
    expect(text).toContain("welcome on board");
  });
});

describe("sendAdvancedApplicationNotification", () => {
  it("includes applicant name and Google Doc URL", async () => {
    const { to, subject, text } = await captureBody("applicationNotification");
    expect(to).toBe("membership@example.com");
    expect(subject).toBe("New Advanced Membership Application — Jane Doe");
    expect(text).toContain("Applicant: Jane Doe");
    expect(text).toContain("https://docs.google.com/document/d/abc");
  });
});

describe("sendBasicApplicationNotification", () => {
  it("includes associate name and review doc URL", async () => {
    const { to, subject, text } = await captureBody("basicApplicationNotification");
    expect(to).toBe("membership@example.com");
    expect(subject).toBe("New Basic Membership Application — Bob Smith");
    expect(text).toContain("Applicant: Bob Smith");
    expect(text).toContain("https://docs.google.com/document/d/xyz");
  });
});

describe("sendResumeLink", () => {
  it("includes the resume link and applicant name", async () => {
    const { to, subject, text } = await captureBody("resume");
    expect(to).toBe("jane@example.com");
    expect(subject).toBe("Your Re:Member Advanced Membership Application");
    expect(text).toContain("Dear Jane Doe");
    expect(text).toContain("https://example.com/resume/abc123");
    expect(text).toContain("If you did not start this application, please ignore this email");
  });
});
