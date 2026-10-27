import type { APIRoute } from "astro";
import * as Sentry from "@sentry/node";
import crypto from "node:crypto";
import {
  calcFirstTermAmount,
  formatAmount,
  isCheckoutDryRunEnabled,
  getNextRenewalAnchorEpoch,
  getSiteBaseUrl,
  type MembershipPlan,
} from "../../lib/membership-terms";
import { CHECKOUT_REF_PLACEHOLDER, getPaymentProvider, type PriceInfo } from "../../lib/payments";
import { appendBasicApplication } from "../../lib/google-sheets";
import { CURRENCY, formatAnchorDate } from "../../lib/config";
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

const VALID_PLANS: MembershipPlan[] = ["basic", "advanced"];

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
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
    return badRequest("Invalid plan. Use 'basic' or 'advanced'.");
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
    const result = await validateTier("basic", payload, "application");
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

  const provider = getPaymentProvider();
  const missingApiConfig = provider.missingConfig("api");
  if (missingApiConfig.length > 0) {
    return Response.json(
      { error: `Server is missing ${missingApiConfig[0]}.` },
      { status: 500 },
    );
  }

  const dryRun = isCheckoutDryRunEnabled();
  const billingCycleAnchor = getNextRenewalAnchorEpoch();
  const siteBaseUrl = getSiteBaseUrl(request.url);

  let recurringPrice: PriceInfo;
  try {
    recurringPrice = await provider.resolvePrice(plan, "application");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("MISSING_CONFIG")) {
      return Response.json(
        { error: `Server is missing recurring price ID for plan '${plan}'.` },
        { status: 500 },
      );
    }
    if (message.includes("INVALID_CURRENCY") || message.includes("INVALID_UNIT_AMOUNT")) {
      return Response.json(
        { error: `Recurring price must be a fixed ${CURRENCY.toUpperCase()} amount.` },
        { status: 500 },
      );
    }
    Sentry.captureException(error, { extra: { plan, email } });
    logger.error("checkout_session.price_resolve_failed", { plan, error: message });
    return Response.json({ error: message }, { status: 500 });
  }

  const missingWebhookConfig = provider.missingConfig("webhook");
  if (dryRun && missingWebhookConfig.length > 0) {
    return Response.json(
      { error: `Server is missing ${missingWebhookConfig[0]} required for dry-run validation.` },
      { status: 500 },
    );
  }

  if (!recurringPrice.unitAmount) {
    return Response.json(
      { error: `Recurring price must be a fixed ${CURRENCY.toUpperCase()} amount.` },
      { status: 500 },
    );
  }

  const recurringPriceId = recurringPrice.priceRef;
  const annualAmount = recurringPrice.unitAmount;
  const returningCustomer = await provider.findReturningCustomer(email);

  // First-term amount: prorated based on weeks remaining until next July 1.
  // New customers get the prorated amount; existing subscribers pay full price.
  const firstTermAmount = returningCustomer?.hadSubscription
    ? annualAmount
    : calcFirstTermAmount(annualAmount);
  const proratedFirstTerm = firstTermAmount !== annualAmount;

  const renewalMessage = `Then ${formatAmount(annualAmount)} per year starting ${formatAnchorDate()}.`;
  const basicApplicationId = isBasicApply ? crypto.randomUUID() : "";

  if (dryRun) {
    logger.info("checkout_session.dry_run_validated", {
      plan,
      email,
      customerId: returningCustomer?.customerRef,
      recurringPriceId,
      firstTermAmount,
      annualAmount,
      proratedFirstTerm,
      billingCycleAnchor,
    });

    return Response.json({
      dryRun: true,
      message:
        "CHECKOUT_DRY_RUN is enabled. Payment provider keys and price configuration validated; no checkout was created.",
      plan,
      firstTermAmount,
      annualAmount,
      billingCycleAnchor,
      proratedFirstTerm,
      renewalMessage,
    });
  }

  const metadata: Record<string, string> = {
    flow: "option_c",
    plan,
    recurring_price_id: recurringPriceId,
    annual_amount: String(annualAmount),
    next_july1_epoch: String(billingCycleAnchor),
    renewal_message: renewalMessage,
    first_name: firstName,
    last_name: lastName,
    phone: phone ?? "",
  };
  if (basicApplicationId) {
    metadata.application_source = "apply";
    metadata.basic_application_id = basicApplicationId;
    metadata.list_on_page = listOnPage ?? "";
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
        // Phase K: tier label resolved via getTier (single source of truth
        // for "Associate Membership" / "Professional Membership" / future tiers).
        name: getTier(plan as "basic" | "advanced").label,
        description: renewalMessage,
      },
      customerEmail: email,
      customerRef: returningCustomer?.customerRef,
      clientReference: email,
      metadata,
      successUrl:
        plan === "basic"
          ? `${siteBaseUrl}/associate-membership?session_id=${CHECKOUT_REF_PLACEHOLDER}`
          : `${siteBaseUrl}/success?session_id=${CHECKOUT_REF_PLACEHOLDER}`,
      cancelUrl: `${siteBaseUrl}/cancel`,
      submitMessage: renewalMessage,
      idempotencyKey: `checkout:${plan}:${email}:${firstTermAmount}`,
    });

    logger.info("checkout_session.created", {
      plan,
      sessionId: checkout.checkoutRef,
      customerId: returningCustomer?.customerRef,
      firstTermAmount,
      annualAmount,
      proratedFirstTerm,
      billingCycleAnchor,
      basicApplicationId: basicApplicationId || undefined,
    });

    return Response.json({
      id: checkout.checkoutRef,
      url: checkout.redirectUrl,
      plan,
      firstTermAmount,
      annualAmount,
      billingCycleAnchor,
      proratedFirstTerm,
      renewalMessage,
    });
  } catch (error) {
    Sentry.captureException(error, { extra: { plan, email } });
    const message = provider.userFacingError(error) ?? "Unable to create checkout session.";
    logger.error("checkout_session.create_failed", {
      plan,
      error: message,
    });
    return Response.json({ error: message }, { status: 500 });
  }
};
