import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMessage } from "./email-sender";

// ---------------------------------------------------------------------------
// createMessage — pure function, no external dependencies
// ---------------------------------------------------------------------------

function decodeRaw(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

describe("createMessage", () => {
  it("encodes To, From, Subject and Body headers", () => {
    const raw = createMessage({ to: "a@b.com", subject: "Test", body: "Hello" }, "no-reply@eldaa.org.nz");
    const decoded = decodeRaw(raw);
    expect(decoded).toContain("To: a@b.com");
    expect(decoded).toContain("From: no-reply@eldaa.org.nz");
    expect(decoded).toContain("Subject: Test");
    expect(decoded).toContain("Hello");
  });

  it("includes Reply-To when provided", () => {
    const raw = createMessage({ to: "a@b.com", subject: "S", body: "B", replyTo: "help@eldaa.org.nz" }, "n@e.com");
    expect(decodeRaw(raw)).toContain("Reply-To: help@eldaa.org.nz");
  });

  it("omits Reply-To when not provided", () => {
    const raw = createMessage({ to: "a@b.com", subject: "S", body: "B" }, "n@e.com");
    expect(decodeRaw(raw)).not.toContain("Reply-To:");
  });

  it("uses CRLF line endings", () => {
    const raw = createMessage({ to: "a@b.com", subject: "S", body: "B" }, "n@e.com");
    const decoded = decodeRaw(raw);
    expect(decoded).not.toContain("\n\n");
    expect(decoded).toContain("\r\n");
  });
});

// ---------------------------------------------------------------------------
// sendProfessionalConfirmation — template correctness
// ---------------------------------------------------------------------------

describe("sendProfessionalConfirmation", () => {
  it("produces correct email content for a named applicant", () => {
    const fullName = "Jane Doe";
    const subject = "Your ELDAA Professional Membership Application";
    const body = `Dear ${fullName},

Thank you for your application to become a Professional Member of ELDAA. We will process your application and get back to you as soon as we can.

We look forward to seeing you soon.

Kia ora,
ELDAA Committee`;

    const raw = createMessage({ to: "jane@example.com", subject, body }, "no-reply@eldaa.org.nz");
    const decoded = decodeRaw(raw);
    expect(decoded).toContain("To: jane@example.com");
    expect(decoded).toContain("Subject: Your ELDAA Professional Membership Application");
    expect(decoded).toContain("Dear Jane Doe");
    expect(decoded).toContain("Thank you for your application to become a Professional Member of ELDAA");
    expect(decoded).toContain("Kia ora");
    expect(decoded).toContain("ELDAA Committee");
    expect(decoded).not.toContain("Reply-To:");
  });
});

// ---------------------------------------------------------------------------
// sendAssociateConfirmation — template correctness
// ---------------------------------------------------------------------------

describe("sendAssociateConfirmation", () => {
  const fullName = "Bob Smith";
  const subject = "Welcome to ELDAA — Associate Membership Confirmed";

  function makeBody(listOnPage: boolean): string {
    const listNote = listOnPage
      ? "You have requested to be listed on our Associate Member list on our website — we will process that shortly."
      : "You have not requested to be listed at this time. If you would like to be added in future, please email us at membership@eldaa.org.nz.";
    return `Welcome to ELDAA ☺

Dear ${fullName},

We would like to officially welcome you on board the End of Life Doula Alliance of Aotearoa as an Associate Member. We are delighted you are joining us in this role, and look forward to supporting you in your mahi.

${listNote}

Associate Member Resources: Access your resources at https://eldaa.org.nz — Members Area — Members Login. If you haven't signed up yet, click 'Sign up' and we will approve your access. If you're already a member, click 'Log In'.

You will find recordings of our educational sessions and other relevant information there.

Meetings: We look forward to seeing you at our membership meetings — this is a great way to connect with your peers. We hold educational sessions (all members — last Monday of the month) and, every other month, a confidential meetup for professional members only (last Tuesday of the month). We send out links prior to each meeting.

Networking: We encourage you to connect with others in your area through our Doula hubs. Please reach out to any of us at any time if you need support — we are here for each other.

Questions? Email us at membership@eldaa.org.nz — we would love your feedback and any ideas you have to support you in your mahi.

Again, welcome on board ☺

Kia ora,
ELDAA Committee`;
  }

  it("includes listing note when listOnPage is true", () => {
    const body = makeBody(true);
    const raw = createMessage({ to: "bob@example.com", subject, body, replyTo: "membership@eldaa.org.nz" }, "no-reply@eldaa.org.nz");
    const decoded = decodeRaw(raw);
    expect(decoded).toContain("To: bob@example.com");
    expect(decoded).toContain("Reply-To: membership@eldaa.org.nz");
    expect(decoded).toContain("You have requested to be listed on our Associate Member list");
  });

  it("includes non-listing note when listOnPage is false", () => {
    const body = makeBody(false);
    const raw = createMessage({ to: "bob@example.com", subject, body, replyTo: "membership@eldaa.org.nz" }, "no-reply@eldaa.org.nz");
    const decoded = decodeRaw(raw);
    expect(decoded).toContain("You have not requested to be listed at this time");
    expect(decoded).toContain("membership@eldaa.org.nz");
  });

  it("includes Reply-To: membership@eldaa.org.nz", () => {
    const body = makeBody(false);
    const raw = createMessage({ to: "bob@example.com", subject, body, replyTo: "membership@eldaa.org.nz" }, "no-reply@eldaa.org.nz");
    expect(decodeRaw(raw)).toContain("Reply-To: membership@eldaa.org.nz");
  });

  it("includes resources, meetings, networking and welcome content", () => {
    const body = makeBody(false);
    const raw = createMessage({ to: "bob@example.com", subject, body, replyTo: "membership@eldaa.org.nz" }, "no-reply@eldaa.org.nz");
    const decoded = decodeRaw(raw);
    expect(decoded).toContain("Associate Member Resources");
    expect(decoded).toContain("https://eldaa.org.nz");
    expect(decoded).toContain("Members Login");
    expect(decoded).toContain("Meetings");
    expect(decoded).toContain("Networking");
    expect(decoded).toContain("welcome on board");
    expect(decoded).toContain("Kia ora");
  });
});

// ---------------------------------------------------------------------------
// sendProfessionalApplicationNotification — template correctness
// ---------------------------------------------------------------------------

describe("sendProfessionalApplicationNotification", () => {
  it("includes applicant name and Google Doc URL", () => {
    const subject = "New Professional Membership Application — Jane Doe";
    const body = `A new professional membership application has been received and the review document is ready.

Applicant: Jane Doe
Review document: https://docs.google.com/document/d/abc123

Please log in to review the application and continue the membership process.

ELDAA`;

    const raw = createMessage({ to: "membership@eldaa.org.nz", subject, body }, "no-reply@eldaa.org.nz");
    const decoded = decodeRaw(raw);
    expect(decoded).toContain("To: membership@eldaa.org.nz");
    expect(decoded).toContain("Subject: New Professional Membership Application — Jane Doe");
    expect(decoded).toContain("Applicant: Jane Doe");
    expect(decoded).toContain("Review document: https://docs.google.com/document/d/abc123");
  });
});

// ---------------------------------------------------------------------------
// sendResumeLink — template correctness
// ---------------------------------------------------------------------------

describe("sendResumeLink", () => {
  it("includes resume link and application context", () => {
    const fullName = "Jane Doe";
    const resumeLink = "https://eldaa.org.nz/resume/abc123";
    const subject = "Your ELDAA Professional Membership Application";
    const body = `Dear ${fullName},

Thank you for starting your Professional Membership application with ELDAA.

To continue your application, please click the link below:
${resumeLink}

This link will allow you to upload your required documents and complete your application.

If you did not start this application, please ignore this email.

Best regards,
ELDAA`;

    const raw = createMessage({ to: "jane@example.com", subject, body }, "no-reply@eldaa.org.nz");
    const decoded = decodeRaw(raw);
    expect(decoded).toContain("To: jane@example.com");
    expect(decoded).toContain("Subject: Your ELDAA Professional Membership Application");
    expect(decoded).toContain("Dear Jane Doe");
    expect(decoded).toContain(resumeLink);
    expect(decoded).toContain("If you did not start this application, please ignore this email");
  });
});