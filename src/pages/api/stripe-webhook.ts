import type { APIRoute } from "astro";
import Stripe from "stripe";
import * as Sentry from "@sentry/node";
import {
  getMembership,
  setAwaitingSubscription,
  setActive,
  setCancelled,
  setPaymentFailed,
} from "../../lib/memberships";
import { appendCheckoutLog } from "../../lib/google-sheets";
import { logger } from "../../lib/logger";
import { getApplicantById, markApplicantPaid } from "../../lib/upload-sheet";
import { appendRenewal, getRenewalById, getRenewalByStripeRef, markRenewalPaid, getRenewalsSheetUrl } from "../../lib/renewal-sheet";
import { getTier, TIERS } from "../../lib/forms/tiers";
import { TIMEZONE } from "../../lib/config";
import { randomUUID } from "node:crypto";
import { getPublicAppUrl } from "../../lib/staging";
import { createAdvancedApplicationReviewDoc, createBasicApplicationReviewDoc, refreshAdvancedIndexDoc, refreshBasicIndexDoc } from "../../lib/google-docs";
import { sendAdvancedConfirmation, sendAdvancedApplicationNotification, sendBasicConfirmation, sendBasicApplicationNotification, sendRenewalPdLogLink, sendRenewalAdminNotification } from "../../lib/email-sender";
import { getRecipientsForEvent } from "../../lib/notification-rules";
import { enqueueAndPush, isXeroEnabled } from "../../lib/xero-sync";
import { getPaymentFacts } from "../../lib/stripe-payment-facts";
import { CURRENCY } from "../../lib/config";
import type { XeroSyncFlow } from "../../lib/xero-sync-sheet";

// Initialize Sentry lazily — only when DSN is present
function getSentry() {
  if (process.env.SENTRY_DSN && !Sentry.isInitialized()) {
    Sentry.init({ dsn: process.env.SENTRY_DSN });
  }
  return Sentry;
}

/**
 * Records a payment for Xero (spec 016).
 *
 * Awaited, never fire-and-forget: fly.toml sets min_machines_running = 0,
 * so a promise left running after the response may simply be killed.
 *
 * Wrapped in try/catch even though enqueueAndPush is contractually
 * non-rejecting. Throwing here would return 500, Stripe would replay the
 * event, and the side effects above would re-fire — a second Google Doc, a
 * second confirmation email, a second admin notification. Belt and braces on
 * the one rule that must not break.
 *
 * A no-op unless XERO_ENABLED is set, so forks that do not use Xero pay
 * nothing but this call.
 */
async function pushToXero(
  stripe: Stripe,
  source: Stripe.Checkout.Session | Stripe.Invoice,
  base: {
    eventType: string;
    flow: XeroSyncFlow;
    internalId: string;
    email: string;
    contactName: string;
    amountCents: number;
    currency: string;
    livemode: boolean;
  },
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  // Checked here as well as inside enqueueAndPush: getPaymentFacts costs a
  // Stripe API round-trip, and a fork that never sets XERO_ENABLED should not
  // pay it on every payment.
  if (!isXeroEnabled()) return;

  try {
    const stripeId = source.id ?? "";
    if (!stripeId) {
      log.warn("xero.skip_missing_stripe_id", { flow: base.flow });
      return;
    }
    const facts = await getPaymentFacts(stripe, source);
    if (facts.fallback) {
      // The date is a guess, so the Stripe feed line may not auto-match.
      log.warn("xero.payment_facts_fallback", { stripeId, flow: base.flow });
    }
    await enqueueAndPush({
      ...base,
      stripeId,
      // ContactNumber is keyed on this, so it must be stable.
      email: base.email.trim().toLowerCase(),
      contactName: base.contactName.trim(),
      paidAt: facts.paidAt,
      feeCents: facts.feeCents,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("xero.enqueue_failed_swallowed", { flow: base.flow, error: msg });
  }
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
  livemode: boolean,
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
      const adminEmail = process.env.ADMIN_EMAIL?.trim() || "admin@example.com";
      const fullName = `${renewal.firstName} ${renewal.lastName}`.trim();
      const adminTier = renewal.tier === "basic" ? "basic" : "adv";
      const amountCents = renewal.amountPaidCents;
      const recipients = await getRecipientsForEvent("advanced_renewal_received", adminEmail);
      recipients.forEach((to) => {
        sendRenewalAdminNotification(
          to,
          adminTier,
          fullName,
          renewal.email ?? "",
          renewalId,
          amountCents,
          getRenewalsSheetUrl(),
        ).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          log.error("renewal_admin_notification_failed", { err: msg, renewalId });
        });
      });
    }

    // Send PD log link to member (non-blocking, PM only)
    if (renewal.tier === "adv" && renewal.email) {
      const appUrl = getPublicAppUrl();
      const pdLogLink = `${appUrl}/renew/pd-log?token=${renewalId}`;
      const fullName = `${renewal.firstName} ${renewal.lastName}`.trim();
      sendRenewalPdLogLink(renewal.email, fullName, pdLogLink, renewalId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("renewal_pd_log_email_failed", { err: msg, renewalId });
      });
    }

    await pushToXero(
      stripe,
      session,
      {
        eventType: "checkout.session.completed",
        flow: "renewal",
        internalId: renewalId,
        email: renewal.email ?? "",
        contactName: `${renewal.firstName ?? ""} ${renewal.lastName ?? ""}`,
        amountCents: renewal.amountPaidCents ?? session.amount_total ?? 0,
        currency: session.currency ?? CURRENCY,
        livemode,
      },
      log,
    );

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

  // Already processed this checkout session? The durable mirror is a
  // fast-path guard only — the Stripe idempotency key on subscription
  // creation below is the real safety mechanism, so a wiped/missing mirror
  // row can never cause a duplicate subscription.
  const existing = await getMembership(customerId);
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

    // Record the deferred subscription creation in the durable mirror
    await setAwaitingSubscription(customerId, {
      plan: plan || "",
      recurringPriceId,
      nextJuly1Epoch,
      joinedAt: new Date().toISOString(),
      subscriptionId,
    }, session.id);

    // Mark as active since subscription is now set up
    await setActive(customerId, subscriptionId, session.id);
  }

  // Mark professional applicant paid/complete in the application sheet.
  const applicantId = session.metadata?.applicant_id;
  let advancedApplicant = null;
  if (plan === "advanced" && applicantId) {
    await markApplicantPaid(applicantId, session.id);
    log.info("checkout_completed.applicant_marked_paid", {
      applicantId,
      sessionId: session.id,
    });

    // Send confirmation email to the applicant (non-blocking)
    advancedApplicant = await getApplicantById(applicantId);
    if (advancedApplicant?.email && advancedApplicant?.firstName) {
      sendAdvancedConfirmation(
        advancedApplicant.email,
        advancedApplicant.firstName,
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

    // Falls back to session metadata when the applicant row could not be
    // read — a missing sheet row must not also cost us the Xero invoice.
    await pushToXero(
      stripe,
      session,
      {
        eventType: "checkout.session.completed",
        flow: "advanced_new",
        internalId: applicantId,
        email: advancedApplicant?.email ?? session.customer_email ?? "",
        contactName: advancedApplicant
          ? `${advancedApplicant.firstName ?? ""} ${advancedApplicant.lastName ?? ""}`
          : `${session.metadata?.first_name ?? ""} ${session.metadata?.last_name ?? ""}`,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? CURRENCY,
        livemode,
      },
      log,
    );
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
  if (plan === "advanced" && applicantId && advancedApplicant) {
    createAdvancedApplicationReviewDoc(advancedApplicant).then(async (docUrl: string) => {
      const membershipEmail = process.env.SUPPORT_EMAIL?.trim() || "membership@example.com";
      const applicantFullName = `${advancedApplicant.firstName} ${advancedApplicant.lastName}`;
      const recipients = await getRecipientsForEvent("advanced_payment_received", membershipEmail);
      recipients.forEach((to) => {
        sendAdvancedApplicationNotification(to, applicantFullName, docUrl, applicantId).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          log.error("checkout_completed.internal_notification_failed", {
            applicantId,
            sessionId: session.id,
            error: msg,
          });
        });
      });
      // Refresh PM index doc
      refreshAdvancedIndexDoc().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("checkout_completed.pm_index_refresh_failed", { applicantId, sessionId: session.id, error: msg });
      });
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("checkout_completed.review_doc_failed", {
        applicantId,
        sessionId: session.id,
        error: msg,
      });
    });
  } else if (plan === "advanced" && applicantId) {
    log.warn("checkout_completed.applicant_not_found_for_review_doc", {
      applicantId,
      sessionId: session.id,
    });
  }

  // Create a Google Doc review document for associate applications
  const basicApplicationId = session.metadata?.basic_application_id;
  const associateListOnPage = session.metadata?.list_on_page ?? "";
  if (plan === "basic" && basicApplicationId) {
    const associateDocData = {
      applicationId: basicApplicationId,
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
    createBasicApplicationReviewDoc(associateDocData).then(async (docUrl) => {
      const fullName = `${associateDocData.firstName} ${associateDocData.lastName}`;
      sendBasicConfirmation(
        associateDocData.email,
        fullName,
        associateListOnPage === "yes",
        basicApplicationId
      ).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("checkout_completed.associate_confirmation_failed", {
          basicApplicationId,
          sessionId: session.id,
          error: msg,
        });
      });

      // Send internal committee notification for AM
      const adminEmail = process.env.ADMIN_EMAIL?.trim() || "admin@example.com";
      const recipients = await getRecipientsForEvent("basic_payment_received", adminEmail);
      recipients.forEach((to) => {
        sendBasicApplicationNotification(
          to,
          fullName,
          docUrl,
          basicApplicationId
        ).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          log.error("checkout_completed.associate_internal_notification_failed", {
            basicApplicationId,
            sessionId: session.id,
            error: msg,
          });
        });
      });
      // Refresh AM index doc
      refreshBasicIndexDoc().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("checkout_completed.am_index_refresh_failed", { basicApplicationId, sessionId: session.id, error: msg });
      });
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("checkout_completed.associate_review_doc_failed", {
        basicApplicationId,
        sessionId: session.id,
        error: msg,
      });
    });

    await pushToXero(
      stripe,
      session,
      {
        eventType: "checkout.session.completed",
        flow: "basic_new",
        internalId: basicApplicationId,
        email: associateDocData.email,
        contactName: `${associateDocData.firstName} ${associateDocData.lastName}`,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? CURRENCY,
        livemode,
      },
      log,
    );
  }
}

/**
 * Records automatic renewals (spec 005 REQ-MR-009/-010, spec 008 acceptance
 * criterion 3). Option C year 2+: the deferred subscription's trial ends at
 * the anchor date, Stripe charges the saved card and emits
 * `invoice.payment_succeeded` with `billing_reason: subscription_cycle`.
 * The auto-renewal joins the manual-renewal rails: one Renewals-sheet ledger,
 * machine- and member-created rows side by side, so every downstream flow
 * (admin notification, advanced PD-log link, future Xero trigger) keys off
 * the same rows.
 *
 * NOTE: the old handler filtered on `invoice.metadata.flow` — dead logic,
 * because `flow` lives on the SUBSCRIPTION's metadata and Stripe does not
 * propagate it to `invoice.metadata`. It appears in the invoice's
 * `parent.subscription_details.metadata` snapshot (retrieval fallback below).
 */
async function handleInvoicePaid(
  stripe: Stripe,
  invoice: Stripe.Invoice,
  log: ReturnType<typeof logger.child>,
  livemode: boolean,
): Promise<void> {
  // D2 — only real anchor-date cycle invoices are renewals. Skips the $0
  // subscription_create invoice Stripe raises when the trialing subscription
  // is created (payment_succeeded fires for $0 invoices too).
  if (invoice.billing_reason !== "subscription_cycle") {
    log.info("invoice.paid.skip_billing_reason", {
      invoiceId: invoice.id,
      billingReason: invoice.billing_reason,
    });
    return;
  }
  if (!invoice.amount_paid) {
    log.info("invoice.paid.skip_zero_amount", { invoiceId: invoice.id });
    return;
  }

  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const subDetails = invoice.parent?.subscription_details ?? null;
  const subscriptionId =
    typeof subDetails?.subscription === "string"
      ? subDetails.subscription
      : subDetails?.subscription?.id;
  if (!customerId || !subscriptionId) {
    log.warn("invoice.paid.missing_ids", {
      invoiceId: invoice.id,
      customerId,
      subscriptionId,
    });
    return;
  }

  // D3 — flow/plan live on the SUBSCRIPTION's metadata. Prefer the invoice's
  // subscription_details snapshot (no API call); fall back to retrieving the
  // subscription for older invoices/API shapes.
  let subMeta: Record<string, string> = (subDetails?.metadata ?? {}) as Record<string, string>;
  if (!subMeta.flow) {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    subMeta = (sub.metadata ?? {}) as Record<string, string>;
  }
  if (subMeta.flow !== "option_c") {
    log.info("invoice.paid.skip_flow", {
      invoiceId: invoice.id,
      flow: subMeta.flow ?? "(none)",
    });
    return;
  }

  // D4 — idempotency at the ledger boundary: the invoice ID lives in the
  // Renewals row's stripe_session column (semantically "the Stripe payment
  // reference"). Replay of the same invoice → no duplicate row.
  const invoiceId = invoice.id ?? "";
  const existing = await getRenewalByStripeRef(invoiceId);
  if (existing) {
    log.info("invoice.paid.already_recorded", {
      invoiceId,
      renewalId: existing.renewalId,
    });
    return;
  }

  // D5 — derive the machine-created row.
  const plan = subMeta.plan ?? "";
  let tier: string;
  try {
    tier = getTier(plan).storageValue;
  } catch {
    log.warn("invoice.paid.unknown_plan_metadata", { invoiceId, plan });
    tier = TIERS.basic.storageValue;
  }
  const fullName = (invoice.customer_name ?? "").trim();
  const splitAt = fullName.lastIndexOf(" ");
  const firstName = splitAt === -1 ? fullName : fullName.slice(0, splitAt);
  const lastName = splitAt === -1 ? "" : fullName.slice(splitAt + 1);
  // Membership year being paid for = year of the line-period START in the
  // org's timezone (matches manual-renewal semantics, REQ-MR-003).
  const periodStart = invoice.lines?.data?.[0]?.period?.start ?? invoice.created;
  const year = Number(
    new Intl.DateTimeFormat("en", { timeZone: TIMEZONE, year: "numeric" }).format(
      new Date(periodStart * 1000),
    ),
  );
  const paidAt = new Date().toISOString();
  const renewalId = randomUUID();

  // D6 — the Renewals append is the synchronous critical write. A failure
  // THROWS: the route's error path returns 500, Stripe retries, and the D4
  // dedupe makes the retry safe.
  await appendRenewal({
    renewalId,
    tier,
    year,
    firstName,
    lastName,
    email: invoice.customer_email ?? "",
    phone: "",
    pdEntries: [],
    amountCents: invoice.amount_paid,
    currency: invoice.currency ?? "",
    stripeSession: invoiceId,
    paymentStatus: "paid",
    createdAt: paidAt,
    paidAt,
  });
  log.info("invoice.paid.auto_renewal_recorded", {
    invoiceId,
    renewalId,
    customerId,
    tier,
    year,
    amountCents: invoice.amount_paid,
  });

  // D6 — everything below is async fire-and-forget, individually logged.
  const adminEmail = process.env.ADMIN_EMAIL?.trim() || "admin@example.com";
  const adminTier = tier === "basic" ? "basic" : "adv";
  sendRenewalAdminNotification(
    adminEmail,
    adminTier,
    fullName,
    invoice.customer_email ?? "",
    renewalId,
    invoice.amount_paid,
    getRenewalsSheetUrl(),
  ).catch((err) => {
    log.error("invoice.paid.admin_notification_failed", {
      renewalId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  if (tier === "adv" && invoice.customer_email) {
    const pdLogLink = `${getPublicAppUrl()}/renew/pd-log?token=${renewalId}`;
    sendRenewalPdLogLink(invoice.customer_email, fullName, pdLogLink, renewalId).catch((err) => {
      log.error("invoice.paid.pd_link_failed", {
        renewalId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // Durable mirror (REQ-SW-008) — also self-heals a prior payment_failed.
  setActive(customerId, subscriptionId, invoiceId).catch((err) => {
    log.error("invoice.paid.set_active_failed", {
      customerId,
      subscriptionId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Spec 016 — awaited, not fire-and-forget (see pushToXero's header).
  await pushToXero(
    stripe,
    invoice,
    {
      eventType: "invoice.payment_succeeded",
      flow: "auto_renewal",
      internalId: renewalId,
      email: invoice.customer_email ?? "",
      contactName: fullName,
      amountCents: invoice.amount_paid ?? 0,
      currency: invoice.currency ?? CURRENCY,
      livemode,
    },
    log,
  );
}

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  if (invoice.metadata?.flow !== "option_c") return;

  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : undefined;
  if (!customerId) return;

  await setPaymentFailed(customerId, invoice.id ?? undefined);
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
    await setCancelled(customerId, subscription.id);
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

  await setCancelled(customerId, subscription.id);
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
          event.livemode === true,
        );
        break;
      // D7 — invoice.payment_succeeded ONLY. Do not also subscribe to
      // invoice.paid (fires additionally for out-of-band payments): two
      // subscriptions means every renewal processed twice, with the dedupe
      // doing silent work forever. Update the Stripe dashboard webhook
      // endpoint's event list to match.
      case "invoice.payment_succeeded":
        await handleInvoicePaid(
          stripe,
          event.data.object as Stripe.Invoice,
          log,
          event.livemode === true,
        );
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
