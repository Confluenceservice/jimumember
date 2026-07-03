import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAppendFeedback,
  mockGetRecipientsForEvent,
  mockSendEmail,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockAppendFeedback: vi.fn(),
  mockGetRecipientsForEvent: vi.fn(),
  mockSendEmail: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("../../lib/feedback-sheet", () => ({
  appendFeedback: mockAppendFeedback,
}));

vi.mock("../../lib/notification-rules", () => ({
  getRecipientsForEvent: mockGetRecipientsForEvent,
}));

vi.mock("../../lib/email-sender", () => ({
  sendEmail: mockSendEmail,
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: mockLoggerError,
  },
}));

import { POST } from "./feedback";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("POST /api/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendFeedback.mockResolvedValue(undefined);
    mockGetRecipientsForEvent.mockResolvedValue([]);
    mockSendEmail.mockResolvedValue(undefined);
  });

  it("saves inline feedback with a numeric rating", async () => {
    const res = await POST({
      request: makeRequest({ type: "inline", page: "/advanced/apply (Step 3 of 8)", rating: 2, comment: "Confusing dates" }),
    } as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockAppendFeedback).toHaveBeenCalledTimes(1);
    const call = mockAppendFeedback.mock.calls[0][0];
    expect(call.type).toBe("inline");
    expect(call.page).toBe("/advanced/apply (Step 3 of 8)");
    expect(call.reaction).toBe("2");
    expect(call.comment).toBe("Confusing dates");
    expect(typeof call.timestamp).toBe("string");
  });

  it("saves post_submission feedback with structured answers", async () => {
    const res = await POST({
      request: makeRequest({
        type: "post_submission",
        page: "advanced_success_upload",
        answers: { clarity: "Yes", ease: "Easy", payment: "Smooth" },
        comment: "",
      }),
    } as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    const call = mockAppendFeedback.mock.calls[0][0];
    expect(call.type).toBe("post_submission");
    expect(call.answers).toEqual({ clarity: "Yes", ease: "Easy", payment: "Smooth" });
  });

  it("rejects an invalid type", async () => {
    const res = await POST({ request: makeRequest({ type: "bogus", page: "/apply" }) } as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("type must be");
    expect(mockAppendFeedback).not.toHaveBeenCalled();
  });

  it("rejects a missing page", async () => {
    const res = await POST({ request: makeRequest({ type: "inline", page: "" }) } as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("page is required");
    expect(mockAppendFeedback).not.toHaveBeenCalled();
  });

  it("rejects a rating outside 1-3", async () => {
    const res = await POST({ request: makeRequest({ type: "inline", page: "/apply", rating: 5 }) } as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("rating must be between");
    expect(mockAppendFeedback).not.toHaveBeenCalled();
  });

  it("rejects a non-object answers field", async () => {
    const res = await POST({ request: makeRequest({ type: "post_submission", page: "/apply", answers: "nope" }) } as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("answers must be an object");
    expect(mockAppendFeedback).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON payload", async () => {
    const req = new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST({ request: req } as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid JSON");
    expect(mockAppendFeedback).not.toHaveBeenCalled();
  });

  it("returns 500 when the sheet write fails", async () => {
    mockAppendFeedback.mockRejectedValue(new Error("sheets down"));
    const res = await POST({ request: makeRequest({ type: "inline", page: "/apply", rating: 1 }) } as any);
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toContain("Failed to save feedback");
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it("notifies configured recipients without blocking the response", async () => {
    mockGetRecipientsForEvent.mockResolvedValue(["admin@example.com"]);

    const res = await POST({ request: makeRequest({ type: "inline", page: "/apply", rating: 1 }) } as any);
    expect(res.status).toBe(200);

    await flushMicrotasks();

    expect(mockGetRecipientsForEvent).toHaveBeenCalledWith("feedback_received");
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com", subject: expect.stringContaining("New feedback received") }),
    );
  });

  it("does not fail the request when notification lookup fails", async () => {
    mockGetRecipientsForEvent.mockRejectedValue(new Error("rules unavailable"));
    const res = await POST({ request: makeRequest({ type: "inline", page: "/apply", rating: 1 }) } as any);
    expect(res.status).toBe(200);
    await flushMicrotasks();
    expect(mockLoggerError).toHaveBeenCalledWith(
      "feedback_notification_lookup_failed",
      expect.objectContaining({ page: "/apply" }),
    );
  });
});
