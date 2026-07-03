import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReadNotificationRules, mockLoggerError } = vi.hoisted(() => ({
  mockReadNotificationRules: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("./google-sheets", () => ({
  readNotificationRules: mockReadNotificationRules,
}));

vi.mock("./logger", () => ({
  logger: {
    error: mockLoggerError,
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getRecipientsForEvent } from "./notification-rules";

describe("getRecipientsForEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns enabled recipients for the requested event", async () => {
    mockReadNotificationRules.mockResolvedValueOnce([
      { event: "advanced_payment_received", recipient_email: "membership@club.org", enabled: "TRUE" },
      { event: "basic_payment_received", recipient_email: "admin@club.org", enabled: "TRUE" },
    ]);

    const result = await getRecipientsForEvent("advanced_payment_received");
    expect(result).toEqual(["membership@club.org"]);
  });

  it("returns all recipients when multiple enabled rows match", async () => {
    mockReadNotificationRules.mockResolvedValueOnce([
      { event: "advanced_renewal_received", recipient_email: "a@club.org", enabled: "TRUE" },
      { event: "advanced_renewal_received", recipient_email: "b@club.org", enabled: "TRUE" },
    ]);

    const result = await getRecipientsForEvent("advanced_renewal_received");
    expect(result).toEqual(["a@club.org", "b@club.org"]);
  });

  it("excludes rows whose enabled is not the literal string TRUE", async () => {
    mockReadNotificationRules.mockResolvedValueOnce([
      { event: "basic_payment_received", recipient_email: "lower@club.org", enabled: "true" },
      { event: "basic_payment_received", recipient_email: "false@club.org", enabled: "FALSE" },
      { event: "basic_payment_received", recipient_email: "empty@club.org", enabled: "" },
      { event: "basic_payment_received", recipient_email: "on@club.org", enabled: "TRUE" },
    ]);

    const result = await getRecipientsForEvent("basic_payment_received");
    expect(result).toEqual(["on@club.org"]);
  });

  it("falls back to the env-var recipient when no enabled rule matches", async () => {
    mockReadNotificationRules.mockResolvedValueOnce([
      { event: "basic_payment_received", recipient_email: "admin@club.org", enabled: "TRUE" },
    ]);

    const result = await getRecipientsForEvent("advanced_payment_received", "fallback@club.org");
    expect(result).toEqual(["fallback@club.org"]);
  });

  it("falls back to the env-var recipient when the sheet read throws", async () => {
    mockReadNotificationRules.mockRejectedValueOnce(new Error("sheet timeout"));

    const result = await getRecipientsForEvent("advanced_renewal_received", "fallback@club.org");
    expect(result).toEqual(["fallback@club.org"]);
    expect(mockLoggerError).toHaveBeenCalledWith(
      "notification_rules.read_failed",
      expect.objectContaining({ event: "advanced_renewal_received", error: "sheet timeout" }),
    );
  });

  it("returns empty array when no rule matches and no fallback is given", async () => {
    mockReadNotificationRules.mockResolvedValueOnce([]);

    const result = await getRecipientsForEvent("advanced_payment_received");
    expect(result).toEqual([]);
  });

  it("returns empty array when the sheet read throws and no fallback is given", async () => {
    mockReadNotificationRules.mockRejectedValueOnce(new Error("boom"));

    const result = await getRecipientsForEvent("basic_payment_received");
    expect(result).toEqual([]);
  });
});
