import type { APIRoute } from "astro";
import Stripe from "stripe";
import * as Sentry from "@sentry/node";
import {
  calcFirstTermAmount,
  formatAmountNzd,
  isCheckoutDryRunEnabled,
  getNextJulyAnchorEpoch,
  getSiteBaseUrl,
} from "../../../lib/stripe-checkout";
import { getApplicantByToken } from "../../../lib/upload-sheet";
import { validateCompletion } from "../../../lib/upload-sheet";
import { logger } from "../../../lib/logger";

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
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
    return badRequest("Token is required.");
  }

  // Get applicant
  const applicant = await getApplicantByToken(token);

  if (!applicant) {
    return badRequest("Invalid or expired session.");
  }

  if (String(applicant.paid ?? "").toUpperCase() === "TRUE") {
    return badRequest("Application already completed.");
  }

  // Validate completion (form fields + doc uploads)
  const isComplete = await validateCompletion(applicant.id);

  if (!isComplete) {
    return badRequest(
      "Please complete all form sections and upload all required documents before proceeding."
    );
  }

  // Create Stripe checkout session
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return Response.json(
      { error: "Server is missing STRIPE_SECRET_KEY." },
      { status: 500 }
    );
  }

  const stripe = new Stripe(secretKey);
  const dryRun = isCheckoutDryRunEnabled();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const recurringPriceId = process.env.STRIPE_PRICE_PROFESSIONAL?.trim();
  const billingCycleAnchor = getNextJulyAnchorEpoch();
  const siteBaseUrl = getSiteBaseUrl(url.href);

  if (!recurringPriceId) {
    return Response.json(
      { error: "Server is missing STRIPE_PRICE_PROFESSIONAL." },
      { status: 500 }
    );
  }

  if (dryRun && !webhookSecret) {
    return Response.json(
      { error: "Server is missing STRIPE_WEBHOOK_SECRET required for dry-run validation." },
      { status: 500 }
    );
  }

  try {
    const recurringPrice = await stripe.prices.retrieve(recurringPriceId);
    if (recurringPrice.currency !== "nzd" || !recurringPrice.unit_amount) {
      return Response.json(
        { error: "Recurring price must be a fixed NZD amount." },
        { status: 500 }
      );
    }

    const annualAmount = recurringPrice.unit_amount;

    // First-term amount: prorated based on weeks remaining until next July 1.
    // Upload applicants are always first-time, so they get the prorated amount.
    const firstTermAmount = calcFirstTermAmount(annualAmount);
    const proratedFirstTerm = firstTermAmount !== annualAmount;

    const renewalMessage = `Then ${formatAmountNzd(annualAmount)} per year starting 1 July.`;

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
        plan: "professional",
        firstTermAmount,
        annualAmount,
        proratedFirstTerm,
      });
    }

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      success_url: `${siteBaseUrl}/professional/success-upload?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteBaseUrl}/professional/apply?token=${token}`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "nzd",
            unit_amount: firstTermAmount,
            product_data: {
              name: "Professional Membership",
              description: renewalMessage,
            },
          },
        },
      ],
      metadata: {
        flow: "option_c",
        plan: "professional",
        applicant_id: applicant.id,
        resume_token: token,
        recurring_price_id: recurringPriceId,
        annual_amount: String(annualAmount),
        next_july1_epoch: String(billingCycleAnchor),
        renewal_message: renewalMessage,
        first_name: applicant.firstName,
        last_name: applicant.lastName,
      },
      custom_text: {
        submit: {
          message: renewalMessage,
        },
      },
    };

    params.payment_intent_data = {
      setup_future_usage: "off_session",
    };

    params.customer_creation = "always";
    params.customer_email = applicant.email;

    const session = await stripe.checkout.sessions.create(params);

    logger.info("checkout_session.created_from_upload", {
      plan: "professional",
      applicantId: applicant.id,
      sessionId: session.id,
      firstTermAmount,
      annualAmount,
      proratedFirstTerm,
    });

    return Response.json({
      id: session.id,
      url: session.url,
      plan: "professional",
      firstTermAmount,
      annualAmount,
      proratedFirstTerm,
    });
  } catch (error) {
    Sentry.captureException(error, { extra: { applicantId: applicant.id } });
    logger.error("checkout_session.create_failed", {
      error: error instanceof Error ? error.message : "Unknown",
    });
    return Response.json(
      { error: "Failed to create checkout session." },
      { status: 500 }
    );
  }
};