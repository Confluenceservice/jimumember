import type { APIRoute } from "astro";
import {
  getPaymentProvider,
  WebhookConfigError,
  WebhookSignatureError,
  type ParsedWebhook,
} from "../../lib/payments";
import { getSentry, handlePaymentEvent } from "../../lib/payments/handle-payment-event";
import { logger } from "../../lib/logger";

/**
 * Stripe webhook endpoint. Verification and event mapping live in the Stripe
 * adapter (`provider.parseWebhook`); the domain side effects live in
 * `handlePaymentEvent`. This route only wires the two together.
 */
export const POST: APIRoute = async ({ request }) => {
  const eventId = crypto.randomUUID();
  const provider = getPaymentProvider();
  if (provider.id !== "stripe") {
    return new Response("Not found.", { status: 404 });
  }

  const signature = request.headers.get("stripe-signature");
  const missing = provider.missingConfig("webhook");
  if (!signature || missing.length > 0) {
    logger.error("webhook.missing_config", { eventId, signature: !!signature, missing });
    return new Response("Missing webhook config.", { status: 400 });
  }

  const payload = await request.text();

  let parsed: ParsedWebhook;
  try {
    parsed = await provider.parseWebhook(payload, request.headers);
  } catch (err) {
    if (err instanceof WebhookConfigError) {
      logger.error("webhook.missing_config", { eventId });
      return new Response("Missing webhook config.", { status: 400 });
    }
    if (err instanceof WebhookSignatureError) {
      logger.error("webhook.signature_invalid", { eventId, signatureHeader: signature.slice(0, 20) });
      return new Response("Invalid webhook signature.", { status: 400 });
    }
    getSentry().captureException(err, { extra: { eventId } });
    logger.error("webhook.processing_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response("Webhook processing failed.", { status: 500 });
  }

  const log = logger.child({
    eventId,
    eventType: parsed.eventType,
    apiVersion: parsed.apiVersion,
  });

  log.info("webhook.received");

  if (!parsed.event) {
    log.info("webhook.ignored", { ignoredReason: parsed.ignoredReason });
    return Response.json({ received: true, eventId });
  }

  try {
    await handlePaymentEvent(parsed.event, provider, log);
  } catch (err) {
    const sentry = getSentry();
    sentry.captureException(err, { extra: { eventId, eventType: parsed.eventType } });
    const msg = err instanceof Error ? err.message : String(err);
    log.error("webhook.processing_failed", { error: msg });
    return new Response("Webhook processing failed.", { status: 500 });
  }

  log.info("webhook.completed");
  return Response.json({ received: true, eventId });
};
