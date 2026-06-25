import type { APIRoute } from "astro";
import Stripe from "stripe";
import * as Sentry from "@sentry/node";
import {
  getMembership,
  hasActiveSubscription,
  setAwaitingSubscription,
  setActive,
  setCancelled,
  setPaymentFailed,
} from "../../lib/memberships";
import { appendCheckoutLog } from "../../lib/google-sheets";
import { logger } from "../../lib/logger";
import { getApplicantById, markApplicantPaid } from "../../lib/upload-sheet";
import { getRenewalById, markRenewalPaid } from "../../lib/renewal-sheet";
import { getPublicAppUrl } from "../../lib/staging";
import { createApplicationReviewDoc, createAssociateApplicationReviewDoc, refreshPmIndexDoc, refreshAmIndexDoc } from "../../lib/google-docs";
import { sendProfessionalConfirmation, sendProfessionalApplicationNotification, sendAssociateConfirmation, sendAssociateApplicationNotification, sendRenewalPdLogLink, sendRenewalAdminNotification } from "../../lib/email-sender";

// Initialize Sentry lazily — only when DSN is present
function getSentry() {
  if (process.env.SENTRY_DSN && !Sentry.isInitialized()) {
    Sentry.init({ dsn: process.env.SENTRY_DSN });
  }
  return Sentry;
}

/**
 * Option C (mode=payment):
 * - Checkout charges the first term as a one-time payment
 * - This webhook creates the recurring subscription with trial_end = next July 1
 * - Idempotency key prevents duplicate subscription creation
 */
async function handleCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  // Renewal flow: one-time payment, no subscription
  if (session.metadata?.flow === "renewal") {
    const renewalId = session.metadata?.renewal_id ?? undefined;
    if (!renewalId) {
      log.warn("renewal_missing_id", { sessionId: session.id });
      return;
    }
    const renewal = await getRenewalById(renewalId);
    if (!renewal) {
      log.warn("renewal_not_found", { sessionId: session.id, renewalId });
      return;
    }
    if (renewal.paymentStatus === "paid") {
      log.info("renewal_skip_already_paid", { sessionId: session.id, renewalId });
      return;
    }
    const paidAt = new Date().toISOString();
    await markRenewalPaid(renewalId, session.id, paidAt);

    const sessionCustomerId = typeof session.customer === "string" ? session.customer : "";
    void appendCheckoutLog({
      timestamp: paidAt,
      firstName: renewal.firstName,
      lastName: renewal.lastName,
      phone: renewal.phone,
      email: renewal.email,
      plan: `renewal_${renewal.tier}`,
      amountPaid: renewal.amountPaidCents,
      sessionId: session.id,
      customerId: sessionCustomerId,
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("renewal_checkout_log_failed", { err: msg, renewalId });
    });

    log.info("renewal_marked_paid", { renewalId, sessionId: session.id, tier: renewal.tier });

    // Notify admin (non-blocking, every renewal completion)
    {
      const adminEmail = "admin@eldaa.org.nz";
      const fullName = `${renewal.firstName} ${renewal.lastName}`.trim();
      const adminTier = renewal.tier === "am" ? "am" : "pm";
      const amountCents = renewal.amountPaidCents;
      sendRenewalAdminNotification(
        adminEmail,
        adminTier,
        fullName,
        renewal.email ?? "",
        renewalId,
        amountCents,
      ).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("renewal_admin_notification_failed", { err: msg, renewalId });
      });
    }

    // Send PD log link to member (non-blocking, PM only)
    if (renewal.tier === "pm" && renewal.email) {
      const appUrl = getPublicAppUrl();
      const pdLogLink = `${appUrl}/renew/pd-log?token=${renewalId}`;
      const fullName = `${renewal.firstName} ${renewal.lastName}`.trim();
      sendRenewalPdLogLink(renewal.email, fullName, pdLogLink, renewalId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("renewal_pd_log_email_failed", { err: msg, renewalId });
      });
    }

    return;
  }

  // Only handle Option C flow
  if (session.metadata?.flow !== "option_c") return;

  // Option C uses mode=payment, not mode=subscription
  if (session.mode !== "payment") return;

  const recurringPriceId = session.metadata?.recurring_price_id;
  const plan = session.metadata?.plan;
  const nextJuly1Epoch = parseInt(session.metadata?.next_july1_epoch ?? "0", 10);
  const customerId =
    typeof session.customer === "string" ? session.customer : undefined;

  if (!customerId || !recurringPriceId) {
    log.warn("checkout_completed.missing_metadata", {
      customerId,
      recurringPriceId,
      sessionId: session.id,
    });
    return;
  }

  // Already processed this checkout session? (idempotency via local record)
  const existing = getMembership(customerId);
  const alreadyProcessed = !!existing?.subscriptionId;
  if (alreadyProcessed) {
    log.info("checkout_completed.already_processed", {
      customerId,
      sessionId: session.id,
      existingSubscriptionId: existing.subscriptionId,
    });
  }

  if (!alreadyProcessed) {
    // Retrieve the PaymentIntent to get the saved payment method
    let paymentMethodId: string | undefined;
    if (session.payment_intent && typeof session.payment_intent === "string") {
      try {
        const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
        paymentMethodId =
          typeof pi.payment_method === "string"
            ? pi.payment_method
            : pi.payment_method?.id;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("checkout_completed.payment_intent_retrieve_failed", {
          customerId,
          sessionId: session.id,
          paymentIntent: session.payment_intent,
          error: msg,
        });
      }
    }

    // Create the recurring subscription with trial ending at July 1
    // Use checkout session id as idempotency key to prevent duplicates
    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: recurringPriceId }],
      trial_end: nextJuly1Epoch,
      metadata: {
        flow: "option_c",
        plan: plan ?? "",
        checkout_session_id: session.id,
      },
      expand: ["default_payment_method"],
    };

    // Attach the payment method from the checkout if available
    if (paymentMethodId) {
      try {
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: customerId,
        });
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        });
        subscriptionParams.default_payment_method = paymentMethodId;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("checkout_completed.payment_method_attach_failed", {
          customerId,
          sessionId: session.id,
          paymentMethodId,
          error: msg,
        });
      }
    }

    let subscriptionId: string;
    try {
      const subscription = await stripe.subscriptions.create(subscriptionParams, {
        idempotencyKey: `option_c_sub_${session.id}`,
      });
      subscriptionId = subscription.id;
      log.info("checkout_completed.subscription_created", {
        customerId,
        sessionId: session.id,
        subscriptionId,
        plan,
        recurringPriceId,
        trialEndEpoch: nextJuly1Epoch,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const sentry = getSentry();
      sentry.captureException(err, {
        extra: { customerId, sessionId: session.id, recurringPriceId, plan },
      });
      log.error("checkout_completed.subscription_create_failed", {
        customerId,
        sessionId: session.id,
        error: msg,
      });
      throw err;
    }

    // Record the deferred subscription creation
    setAwaitingSubscription(customerId, {
      plan: plan || "",
      recurringPriceId,
      nextJuly1Epoch,
      joinedAt: new Date().toISOString(),
      subscriptionId,
    });

    // Mark as active since subscription is now set up
    setActive(customerId, subscriptionId);
  }

  // Mark professional applicant paid/complete in the application sheet.
  const applicantId = session.metadata?.applicant_id;
  let professionalApplicant = null;
  if (plan === "professional" && applicantId) {
    await markApplicantPaid(applicantId, session.id);
    log.info("checkout_completed.applicant_marked_paid", {
      applicantId,
      sessionId: session.id,
    });

    // Send confirmation email to the applicant (non-blocking)
    professionalApplicant = await getApplicantById(applicantId);
    if (professionalApplicant?.email && professionalApplicant?.firstName) {
      sendProfessionalConfirmation(
        professionalApplicant.email,
        professionalApplicant.firstName,
        applicantId
      ).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("checkout_completed.confirmation_email_failed", {
          applicantId,
          sessionId: session.id,
          error: msg,
        });
      });
    } else {
      log.warn("checkout_completed.missing_applicant_email_for_confirmation", {
        applicantId,
        sessionId: session.id,
      });
    }
  }

  // Log to Google Sheets (async — don't fail the webhook if this errors)
  const amountPaid = session.amount_total ?? 0;
  appendCheckoutLog({
    timestamp: new Date().toISOString(),
    firstName: session.metadata?.first_name ?? "",
    lastName: session.metadata?.last_name ?? "",
    phone: session.metadata?.phone ?? "",
    email: session.customer_email ?? "",
    plan: plan || "",
    amountPaid,
    sessionId: session.id,
    customerId,
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    const sentry = getSentry();
    sentry.captureException(err, {
      extra: { customerId, sessionId: session.id },
      level: "warning",
    });
    log.error("checkout_completed.sheets_log_failed", {
      customerId,
      sessionId: session.id,
      error: msg,
    });
  });

  // Create a Google Doc review document for professional applications
  if (plan === "professional" && applicantId && professionalApplicant) {
    createApplicationReviewDoc(professionalApplicant).then(async (docUrl) => {
      const membershipEmail = "membership@eldaa.org.nz";
      const applicantFullName = `${professionalApplicant.firstName} ${professionalApplicant.lastName}`;
      sendProfessionalApplicationNotification(membershipEmail, applicantFullName, docUrl, applicantId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("checkout_completed.internal_notification_failed", {
          applicantId,
          sessionId: session.id,
          error: msg,
        });
      });
      // Refresh PM index doc
      refreshPmIndexDoc().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("checkout_completed.pm_index_refresh_failed", { applicantId, sessionId: session.id, error: msg });
      });
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("checkout_completed.review_doc_failed", {
        applicantId,
        sessionId: session.id,
        error: msg,
      });
    });
  } else if (plan === "professional" && applicantId) {
    log.warn("checkout_completed.applicant_not_found_for_review_doc", {
      applicantId,
      sessionId: session.id,
    });
  }

  // Create a Google Doc review document for associate applications
  const associateApplicationId = session.metadata?.associate_application_id;
  const associateListOnPage = session.metadata?.list_on_page ?? "";
  if (plan === "associate" && associateApplicationId) {
    const associateDocData = {
      applicationId: associateApplicationId,
      submittedAt: "",
      firstName: session.metadata?.first_name ?? "",
      lastName: session.metadata?.last_name ?? "",
      email: session.customer_email ?? "",
      phone: session.metadata?.phone ?? "",
      fullAddress: session.metadata?.full_address ?? "",
      postalAddress: session.metadata?.postal_address ?? "",
      businessName: session.metadata?.business_name ?? "",
      interestJoining: session.metadata?.interest_joining ?? "",
      trainingDetails: session.metadata?.training_details ?? "",
      listOnPage: associateListOnPage,
      listingDetails: session.metadata?.listing_details ?? "",
      signature: "",
      applicationDate: "",
      checkoutStatus: "paid",
    };
    createAssociateApplicationReviewDoc(associateDocData).then(async (docUrl) => {
      const fullName = `${associateDocData.firstName} ${associateDocData.lastName}`;
      sendAssociateConfirmation(
        associateDocData.email,
        fullName,
        associateListOnPage === "yes",
        associateApplicationId
      ).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("checkout_completed.associate_confirmation_failed", {
          associateApplicationId,
          sessionId: session.id,
          error: msg,
        });
      });

      // Send internal committee notification for AM
      sendAssociateApplicationNotification(
        "admin@eldaa.org.nz",
        fullName,
        docUrl,
        associateApplicationId
      ).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("checkout_completed.associate_internal_notification_failed", {
          associateApplicationId,
          sessionId: session.id,
          error: msg,
        });
      });
      // Refresh AM index doc
      refreshAmIndexDoc().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("checkout_completed.am_index_refresh_failed", { associateApplicationId, sessionId: session.id, error: msg });
      });
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("checkout_completed.associate_review_doc_failed", {
        associateApplicationId,
        sessionId: session.id,
        error: msg,
      });
    });
  }
}

async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  if (invoice.metadata?.flow !== "option_c") return;

  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : undefined;
  if (!customerId) return;

  if (hasActiveSubscription(customerId)) {
    log.info("invoice.paid.renewal_skip", { customerId, invoiceId: invoice.id });
    return;
  }

  const membership = getMembership(customerId);
  if (!membership) {
    log.warn("invoice.paid.no_membership_record", {
      customerId,
      invoiceId: invoice.id,
    });
    return;
  }
}

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  if (invoice.metadata?.flow !== "option_c") return;

  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : undefined;
  if (!customerId) return;

  setPaymentFailed(customerId);
  log.warn("invoice.payment_failed", { customerId, invoiceId: invoice.id });
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  if (subscription.metadata?.flow !== "option_c") return;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : undefined;
  if (!customerId) return;

  if (subscription.status === "canceled" || subscription.status === "unpaid") {
    setCancelled(customerId);
    log.info("subscription.updated.cancelled", {
      customerId,
      subscriptionId: subscription.id,
      status: subscription.status,
    });
  } else {
    log.info("subscription.updated", {
      customerId,
      subscriptionId: subscription.id,
      status: subscription.status,
    });
  }
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  if (subscription.metadata?.flow !== "option_c") return;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : undefined;
  if (!customerId) return;

  setCancelled(customerId);
  log.info("subscription.deleted", { customerId, subscriptionId: subscription.id });
}

export const POST: APIRoute = async ({ request }) => {
  const eventId = crypto.randomUUID();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!signature || !webhookSecret || !secretKey) {
    logger.error("webhook.missing_config", { eventId, signature: !!signature, webhookSecret: !!webhookSecret, secretKey: !!secretKey });
    return new Response("Missing webhook config.", { status: 400 });
  }

  const stripe = new Stripe(secretKey);
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch {
    logger.error("webhook.signature_invalid", { eventId, signatureHeader: signature.slice(0, 20) });
    return new Response("Invalid webhook signature.", { status: 400 });
  }

  const log = logger.child({
    eventId,
    eventType: event.type,
    apiVersion: event.api_version ?? "unknown",
  });

  log.info("webhook.received");

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          stripe,
          event.data.object as Stripe.Checkout.Session,
          log,
        );
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice, log);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
          log,
        );
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
          log,
        );
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
          log,
        );
        break;
    }
  } catch (err) {
    const sentry = getSentry();
    sentry.captureException(err, { extra: { eventId, eventType: event.type } });
    const msg = err instanceof Error ? err.message : String(err);
    log.error("webhook.processing_failed", { error: msg });
    return new Response("Webhook processing failed.", { status: 500 });
  }

  log.info("webhook.completed");
  return Response.json({ received: true, eventId });
};
