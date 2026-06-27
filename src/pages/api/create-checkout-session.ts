import type { APIRoute } from "astro";
import Stripe from "stripe";
import * as Sentry from "@sentry/node";
import crypto from "node:crypto";
import {
  calcFirstTermAmount,
  formatAmountNzd,
  isCheckoutDryRunEnabled,
  getNextJulyAnchorEpoch,
  getPriceForPlan,
  getSiteBaseUrl,
  type MembershipPlan,
} from "../../lib/stripe-checkout";
import { appendBasicApplication } from "../../lib/google-sheets";
import { logger } from "../../lib/logger";
import { validateTier } from "../../lib/forms/runtime";
import { getTier } from "../../lib/forms/tiers";

type CreateSessionPayload = {
  plan?: MembershipPlan;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  applicationSource?: "apply";
  fullAddress?: string;
  postalAddress?: string;
  businessName?: string;
  interestJoining?: string;
  trainingDetails?: string;
  listOnPage?: "yes" | "no";
  listingDetails?: string;
  signature?: string;
  applicationDate?: string;
};

type ExistingCustomerInfo = {
  id?: string;
  hasPriorSubscriptions: boolean;
};

const VALID_PLANS: MembershipPlan[] = ["basic", "advanced"];

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

async function getExistingCustomerInfo(
  stripe: Stripe,
  email: string,
): Promise<ExistingCustomerInfo> {
  const customers = await stripe.customers.list({ email, limit: 1 });
  const customerId = customers.data[0]?.id;

  if (!customerId) {
    return { hasPriorSubscriptions: false };
  }

  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 1,
  });

  return {
    id: customerId,
    hasPriorSubscriptions: subs.data.length > 0,
  };
}

/**
 * Option C: mode=payment (one-time charge)
 * - First term is charged at checkout as a one-time payment
 * - Webhook creates the recurring subscription deferred with trial_end = next July 1
 * - Payment method is saved for future off-session charges
 */
export const POST: APIRoute = async ({ request }) => {
  let payload: CreateSessionPayload;

  try {
    payload = (await request.json()) as CreateSessionPayload;
  } catch {
    return badRequest("Invalid JSON payload.");
  }

  const plan = payload.plan;
  if (!plan || !VALID_PLANS.includes(plan)) {
    return badRequest("Invalid plan. Use 'associate' or 'professional'.");
  }

  const firstName = payload.firstName?.trim();
  const lastName = payload.lastName?.trim();
  const phone = payload.phone?.trim();
  const email = payload.email?.trim().toLowerCase();
  const applicationSource = payload.applicationSource;
  const isBasicApply = plan === "basic" && applicationSource === "apply";

  if (!firstName) return badRequest("Provide a first name.");
  if (!lastName) return badRequest("Provide a last name.");
  if (!email) return badRequest("Provide an email.");

  // Associate-apply path uses the schema (validateTier). Other plans/flows
  // fall through with the raw payload — `appendBasicApplication` only
  // runs for the associate-apply path.
  let associateValues: Record<string, unknown> | null = null;
  if (isBasicApply) {
    const result = await validateTier("basic", payload);
    if (!result.ok) {
      const [field, message] = Object.entries(result.errors)[0] ?? ["body", "Invalid input"];
      return Response.json({ error: message, field }, { status: 400 });
    }
    associateValues = result.values as Record<string, unknown>;
  }
  const fullAddress = (associateValues ? String(associateValues.fullAddress ?? "") : (payload.fullAddress?.trim() ?? ""));
  const postalAddress = (associateValues ? String(associateValues.postalAddress ?? "") : (payload.postalAddress?.trim() ?? ""));
  const businessName = (associateValues ? String(associateValues.businessName ?? "") : (payload.businessName?.trim() ?? ""));
  const interestJoining = (associateValues ? String(associateValues.interestJoining ?? "") : (payload.interestJoining?.trim() ?? ""));
  const trainingDetails = (associateValues ? String(associateValues.trainingDetails ?? "") : (payload.trainingDetails?.trim() ?? ""));
  const listOnPage = (associateValues ? String(associateValues.listOnPage ?? "") : (payload.listOnPage ?? ""));
  const listingDetails = (associateValues ? String(associateValues.listingDetails ?? "") : (payload.listingDetails?.trim() ?? ""));
  const signature = (associateValues ? String(associateValues.signature ?? "") : (payload.signature?.trim() ?? ""));
  const applicationDate = (associateValues ? String(associateValues.applicationDate ?? "") : (payload.applicationDate?.trim() ?? ""));

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return Response.json(
      { error: "Server is missing STRIPE_SECRET_KEY." },
      { status: 500 },
    );
  }

  const stripe = new Stripe(secretKey, { apiVersion: "2026-02-25.clover" });
  const dryRun = isCheckoutDryRunEnabled();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const recurringPriceId = getPriceForPlan(plan);
  const billingCycleAnchor = getNextJulyAnchorEpoch();
  const siteBaseUrl = getSiteBaseUrl(request.url);
  if (!recurringPriceId) {
    return Response.json(
      { error: `Server is missing recurring price ID for plan '${plan}'.` },
      { status: 500 },
    );
  }

  if (dryRun && !webhookSecret) {
    return Response.json(
      { error: "Server is missing STRIPE_WEBHOOK_SECRET required for dry-run validation." },
      { status: 500 },
    );
  }

  const recurringPrice = await stripe.prices.retrieve(recurringPriceId);
  if (recurringPrice.currency !== "nzd" || !recurringPrice.unit_amount) {
    return Response.json(
      { error: "Recurring price must be a fixed NZD amount." },
      { status: 500 },
    );
  }

  const annualAmount = recurringPrice.unit_amount;
  const customerInfo = await getExistingCustomerInfo(stripe, email);

  // First-term amount: prorated based on weeks remaining until next July 1.
  // New customers get the prorated amount; existing subscribers pay full price.
  const firstTermAmount = customerInfo.hasPriorSubscriptions
    ? annualAmount
    : calcFirstTermAmount(annualAmount);
  const proratedFirstTerm = firstTermAmount !== annualAmount;

  const renewalMessage = `Then ${formatAmountNzd(annualAmount)} per year starting 1 July.`;
  const basicApplicationId = isBasicApply ? crypto.randomUUID() : "";

  if (dryRun) {
    logger.info("checkout_session.dry_run_validated", {
      plan,
      email,
      customerId: customerInfo.id,
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
      plan,
      firstTermAmount,
      annualAmount,
      billingCycleAnchor,
      proratedFirstTerm,
      renewalMessage,
    });
  }

  // mode=payment for Option C: one-time charge, subscription created in webhook
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    success_url:
      plan === "basic"
        ? `${siteBaseUrl}/associate-membership?session_id={CHECKOUT_SESSION_ID}`
        : `${siteBaseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteBaseUrl}/cancel`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "nzd",
          unit_amount: firstTermAmount,
          product_data: {
            // Phase K: tier label resolved via getTier (single source of truth
            // for "Associate Membership" / "Professional Membership" / future tiers).
            name: getTier(plan as "basic" | "advanced").label,
            description: renewalMessage,
          },
        },
      },
    ],
    metadata: {
      flow: "option_c",
      plan,
      recurring_price_id: recurringPriceId,
      annual_amount: String(annualAmount),
      next_july1_epoch: String(billingCycleAnchor),
      renewal_message: renewalMessage,
      first_name: firstName,
      last_name: lastName,
      phone: phone ?? "",
    },
    client_reference_id: email,
    custom_text: {
      submit: {
        message: renewalMessage,
      },
    },
  };
  if (basicApplicationId) {
    params.metadata = {
      ...params.metadata,
      application_source: "apply",
      basic_application_id: basicApplicationId,
      list_on_page: listOnPage ?? "",
    };
  }

  // Save payment method for future off-session charges (renewal billing)
  params.payment_intent_data = {
    setup_future_usage: "off_session",
    receipt_email: email,
  };

  if (customerInfo.id) {
    params.customer = customerInfo.id;
  } else {
    params.customer_creation = "always";
    params.customer_email = email;
  }

  try {
    if (isBasicApply && basicApplicationId) {
      await appendBasicApplication({
        submittedAt: new Date().toISOString(),
        applicationId: basicApplicationId,
        firstName,
        lastName,
        email,
        phone: phone ?? "",
        fullAddress,
        postalAddress,
        businessName,
        interestJoining,
        trainingDetails,
        listOnPage: listOnPage ?? "",
        listingDetails,
        signature,
        applicationDate,
        checkoutStatus: "checkout_requested",
      });
    }
    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: `checkout:${plan}:${email}`,
    });

    logger.info("checkout_session.created", {
      plan,
      sessionId: session.id,
      customerId: customerInfo.id,
      firstTermAmount,
      annualAmount,
      proratedFirstTerm,
      billingCycleAnchor,
      basicApplicationId: basicApplicationId || undefined,
    });

    return Response.json({
      id: session.id,
      url: session.url,
      plan,
      firstTermAmount,
      annualAmount,
      billingCycleAnchor,
      proratedFirstTerm,
      renewalMessage,
    });
  } catch (error) {
    Sentry.captureException(error, { extra: { plan, email } });
    const message =
      error instanceof Stripe.errors.StripeError
        ? error.message
        : "Unable to create checkout session.";
    logger.error("checkout_session.create_failed", {
      plan,
      error: message,
    });
    return Response.json({ error: message }, { status: 500 });
  }
};
