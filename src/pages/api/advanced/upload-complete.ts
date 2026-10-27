import type { APIRoute } from "astro";
import * as Sentry from "@sentry/node";
import {
  calcFirstTermAmount,
  formatAmount,
  isCheckoutDryRunEnabled,
  getNextRenewalAnchorEpoch,
  getSiteBaseUrl,
} from "../../../lib/membership-terms";
import { CHECKOUT_REF_PLACEHOLDER, getPaymentProvider } from "../../../lib/payments";
import { getTier } from "../../../lib/forms/tiers";
import { getApplicantByToken } from "../../../lib/upload-sheet";
import { validateCompletion } from "../../../lib/upload-sheet";
import { CURRENCY, formatAnchorDate } from "../../../lib/config";
import { logger } from "../../../lib/logger";

type ErrorCode =
  | "BAD_REQUEST"
  | "INVALID_TOKEN"
  | "ALREADY_COMPLETED"
  | "INCOMPLETE"
  | "MISSING_CONFIG"
  | "CHECKOUT_ERROR";

function badRequest(message: string, code: ErrorCode = "BAD_REQUEST"): Response {
  return Response.json({ error: message, code }, { status: 400 });
}

export const POST: APIRoute = async ({ request, url }) => {
  let payload: { token?: string };

  try {
    payload = (await request.json()) as { token?: string };
  } catch {
    return badRequest("Invalid JSON payload.");
  }

  const token = payload.token?.trim();

  if (!token) {
    return badRequest("Token is required.", "INVALID_TOKEN");
  }

  // Get applicant
  const applicant = await getApplicantByToken(token);

  if (!applicant) {
    return badRequest("Invalid or expired session.", "INVALID_TOKEN");
  }

  if (String(applicant.paid ?? "").toUpperCase() === "TRUE") {
    return badRequest("Application already completed.", "ALREADY_COMPLETED");
  }

  // Validate completion (form fields + doc uploads)
  const isComplete = await validateCompletion(applicant.id);

  if (!isComplete) {
    return badRequest(
      "Please complete all form sections and upload all required documents before proceeding.",
      "INCOMPLETE"
    );
  }

  // Create checkout
  const provider = getPaymentProvider();
  const missingApiConfig = provider.missingConfig("api");
  if (missingApiConfig.length > 0) {
    return Response.json(
      { error: `Server is missing ${missingApiConfig[0]}.`, code: "MISSING_CONFIG" },
      { status: 500 }
    );
  }

  const tier = getTier("advanced");
  const dryRun = isCheckoutDryRunEnabled();
  const billingCycleAnchor = getNextRenewalAnchorEpoch();
  const siteBaseUrl = getSiteBaseUrl(url.href);

  try {
    let recurringPrice;
    try {
      recurringPrice = await provider.resolvePrice(tier.slug, "application");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("MISSING_CONFIG")) {
        return Response.json(
          { error: `Server is missing ${tier.priceEnvVar}.`, code: "MISSING_CONFIG" },
          { status: 500 }
        );
      }
      if (message.includes("INVALID_CURRENCY") || message.includes("INVALID_UNIT_AMOUNT")) {
        return Response.json(
          { error: `Recurring price must be a fixed ${CURRENCY.toUpperCase()} amount.`, code: "CHECKOUT_ERROR" },
          { status: 500 }
        );
      }
      throw error;
    }

    const missingWebhookConfig = provider.missingConfig("webhook");
    if (dryRun && missingWebhookConfig.length > 0) {
      return Response.json(
        { error: `Server is missing ${missingWebhookConfig[0]} required for dry-run validation.`, code: "MISSING_CONFIG" },
        { status: 500 }
      );
    }

    if (!recurringPrice.unitAmount) {
      return Response.json(
        { error: `Recurring price must be a fixed ${CURRENCY.toUpperCase()} amount.`, code: "CHECKOUT_ERROR" },
        { status: 500 }
      );
    }

    const recurringPriceId = recurringPrice.priceRef;
    const annualAmount = recurringPrice.unitAmount;

    // First-term amount: prorated based on weeks remaining until next July 1.
    // Upload applicants are always first-time, so they get the prorated amount.
    const firstTermAmount = calcFirstTermAmount(annualAmount);
    const proratedFirstTerm = firstTermAmount !== annualAmount;

    const renewalMessage = `Then ${formatAmount(annualAmount)} per year starting ${formatAnchorDate()}.`;

    if (dryRun) {
      logger.info("checkout_session.dry_run_validated_from_upload", {
        plan: "professional",
        applicantId: applicant.id,
        recurringPriceId,
        firstTermAmount,
        annualAmount,
        proratedFirstTerm,
        billingCycleAnchor,
      });

      return Response.json({
        dryRun: true,
        message:
          "CHECKOUT_DRY_RUN is enabled. Stripe keys and price configuration validated; no Checkout Session was created.",
        plan: "advanced",
        firstTermAmount,
        annualAmount,
        proratedFirstTerm,
      });
    }

    // Include firstTermAmount in the key: the prorated amount shrinks each
    // week toward July 1, so a static key would make a return visit in a
    // later week collide with the provider's idempotency cache (same key,
    // different amount → hard idempotency-conflict error).
    const checkout = await provider.createCheckout({
      mode: "first_term_then_annual",
      lineItem: {
        kind: "amount",
        amount: firstTermAmount,
        currency: CURRENCY,
        name: tier.label,
        description: renewalMessage,
      },
      customerEmail: applicant.email,
      clientReference: applicant.id,
      metadata: {
        flow: "option_c",
        plan: "advanced",
        applicant_id: applicant.id,
        resume_token: token,
        recurring_price_id: recurringPriceId,
        annual_amount: String(annualAmount),
        next_july1_epoch: String(billingCycleAnchor),
        renewal_message: renewalMessage,
        first_name: applicant.firstName,
        last_name: applicant.lastName,
      },
      successUrl: `${siteBaseUrl}/advanced/success-upload?session_id=${CHECKOUT_REF_PLACEHOLDER}`,
      cancelUrl: `${siteBaseUrl}/advanced/apply?token=${token}`,
      submitMessage: renewalMessage,
      idempotencyKey: `upload-complete:${applicant.id}:${firstTermAmount}`,
    });

    logger.info("checkout_session.created_from_upload", {
      plan: "professional",
      applicantId: applicant.id,
      sessionId: checkout.checkoutRef,
      firstTermAmount,
      annualAmount,
      proratedFirstTerm,
    });

    return Response.json({
      id: checkout.checkoutRef,
      url: checkout.redirectUrl,
      plan: "advanced",
      firstTermAmount,
      annualAmount,
      proratedFirstTerm,
    });
  } catch (error) {
    const retryable = provider.isRetryableError(error);
    Sentry.captureException(error, { extra: { applicantId: applicant.id, retryable } });
    logger.error("checkout_session.create_failed", {
      error: error instanceof Error ? error.message : "Unknown",
      retryable,
    });
    return Response.json(
      { error: "Failed to create checkout session.", code: "CHECKOUT_ERROR", retryable },
      { status: 500 }
    );
  }
};
