import { readNotificationRules } from "./google-sheets";
import { logger } from "./logger";

/**
 * Notification events that can be routed via the "Notification Rules" sheet tab.
 *
 * The first three are wired into the Stripe webhook today. The remainder are
 * reserved: declaring them keeps the event vocabulary in one place so future
 * wiring is a one-line change, and so admins can pre-seed rows for them.
 */
export type NotificationEvent =
  | "advanced_payment_received"
  | "basic_payment_received"
  | "advanced_renewal_received"
  | "feedback_received"
  // Reserved — not yet wired into the webhook:
  | "basic_application_submitted"
  | "advanced_application_submitted"
  | "document_uploaded"
  | "resume_link_sent";

/**
 * Resolve the recipient addresses for a notification event from the
 * admin-editable "Notification Rules" sheet.
 *
 * Returns every enabled rule's recipient for the event (a single event may have
 * multiple recipients). When the sheet read fails OR no enabled rule matches,
 * falls back to the provided env-var recipient so admin notifications never
 * silently vanish. (This is the deliberate divergence from the eldaa original,
 * which returned `[]` in both cases.)
 *
 * `enabled` matching is case-sensitive on the literal string "TRUE" — a sheet
 * value of "true", "FALSE", or empty disables the row.
 */
export async function getRecipientsForEvent(
  event: NotificationEvent,
  fallback?: string,
): Promise<string[]> {
  try {
    const rules = await readNotificationRules();
    const matched = rules
      .filter((r) => r.event === event && r.enabled === "TRUE")
      .map((r) => r.recipient_email);
    if (matched.length > 0) return matched;
    return fallback ? [fallback] : []; // no enabled rule matched
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("notification_rules.read_failed", { event, error: msg });
    return fallback ? [fallback] : []; // sheet read failed
  }
}
