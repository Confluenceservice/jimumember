import type { APIRoute } from "astro";
import Stripe from "stripe";
import * as Sentry from "@sentry/node";
import {
  formatAmountNzd,
  getNextJulyAnchorEpoch,
  getSiteBaseUrl,
  isPromoWindowNz,
} from "../../../lib/stripe-checkout";
import { getApplicantByToken } from "../../../lib/upload-sheet";
import { getUploadStatus, REQUIRED_DOC_TYPES } from "../../../lib/upload-sheet";
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

  if (applicant.paid) {
    return badRequest("Application already completed.");
  }

  // Check upload status
  const uploadStatus = await getUploadStatus(applicant.id);

  if (!uploadStatus) {
    return badRequest("Application not found.");
  }

  // Verify all documents are uploaded
  const missingDocs = REQUIRED_DOC_TYPES.filter(
    (type) => !uploadStatus.docs[type]
  );

  if (missingDocs.length > 0) {
    return badRequest(
      `Please upload all required documents first. Missing: ${missingDocs.join(", ")}`
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
  const recurringPriceId = process.env.STRIPE_PRICE_PROFESSIONAL?.trim();
  const billingCycleAnchor = getNextJulyAnchorEpoch();
  const siteBaseUrl = getSiteBaseUrl(url.href);

  if (!recurringPriceId) {
    return Response.json(
      { error: "Server is missing STRIPE_PRICE_PROFESSIONAL." },
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
    const inPromoWindow = isPromoWindowNz();

    // For this flow, always charge full amount (no promo code for uploads)
    // Could add promo code support if needed
    const firstTermAmount = annualAmount;

    const renewalMessage = `Then ${formatAmountNzd(annualAmount)} per year starting 1 July.`;

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
        flow: "option_c_upload",
        plan: "professional",
        applicant_id: applicant.id,
        recurring_price_id: recurringPriceId,
        annual_amount: String(annualAmount),
        next_july1_epoch: String(billingCycleAnchor),
        renewal_message: renewalMessage,
        first_name: applicant.fullName.split(" ")[0],
        last_name: applicant.fullName.split(" ").slice(1).join(" ") || "",
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
    });

    return Response.json({
      id: session.id,
      url: session.url,
      plan: "professional",
      firstTermAmount,
      annualAmount,
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