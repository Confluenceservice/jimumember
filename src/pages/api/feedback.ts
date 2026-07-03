import type { APIRoute } from "astro";
import { appendFeedback } from "../../lib/feedback-sheet";
import { getRecipientsForEvent } from "../../lib/notification-rules";
import { sendEmail } from "../../lib/email-sender";
import { logger } from "../../lib/logger";

const VALID_TYPES = new Set(["inline", "post_submission"]);
const MAX_COMMENT_LENGTH = 2000;
const MAX_PAGE_LENGTH = 500;

export const POST: APIRoute = async ({ request }) => {
  let payload: Record<string, unknown>;

  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const type = payload.type;
  if (typeof type !== "string" || !VALID_TYPES.has(type)) {
    return Response.json(
      { error: "type must be 'inline' or 'post_submission'." },
      { status: 400 },
    );
  }

  const page = typeof payload.page === "string" ? payload.page.trim() : "";
  if (!page) {
    return Response.json({ error: "page is required." }, { status: 400 });
  }
  if (page.length > MAX_PAGE_LENGTH) {
    return Response.json({ error: "page is too long." }, { status: 400 });
  }

  const comment = typeof payload.comment === "string" ? payload.comment.trim() : "";
  if (comment.length > MAX_COMMENT_LENGTH) {
    return Response.json({ error: "comment is too long." }, { status: 400 });
  }

  let reaction = "";
  if (typeof payload.reaction === "string") {
    reaction = payload.reaction.trim();
  } else if (typeof payload.rating === "number" && Number.isInteger(payload.rating)) {
    if (payload.rating < 1 || payload.rating > 3) {
      return Response.json({ error: "rating must be between 1 and 3." }, { status: 400 });
    }
    reaction = String(payload.rating);
  }

  let answers: Record<string, string> | undefined;
  if (payload.answers !== undefined) {
    if (typeof payload.answers !== "object" || payload.answers === null || Array.isArray(payload.answers)) {
      return Response.json({ error: "answers must be an object." }, { status: 400 });
    }
    answers = {};
    for (const [key, value] of Object.entries(payload.answers as Record<string, unknown>)) {
      answers[key] = typeof value === "string" ? value : String(value);
    }
  }

  const timestamp = new Date().toISOString();

  try {
    await appendFeedback({ timestamp, type: type as "inline" | "post_submission", page, reaction, comment, answers });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("feedback_write_failed", { page, type, error: errorMessage });
    return Response.json(
      { error: "Failed to save feedback. Please try again." },
      { status: 500 },
    );
  }

  // Fire-and-forget — never block the response on notification delivery.
  getRecipientsForEvent("feedback_received").then((recipients) => {
    recipients.forEach((to) => {
      sendEmail({
        to,
        subject: `New feedback received — ${page}`,
        body: `Type: ${type}\nPage: ${page}\nReaction: ${reaction || "(none)"}\nComment: ${comment || "(none)"}\nAnswers: ${JSON.stringify(answers ?? {})}`,
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("feedback_notification_failed", { page, error: msg });
      });
    });
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("feedback_notification_lookup_failed", { page, error: msg });
  });

  return Response.json({ success: true });
};
