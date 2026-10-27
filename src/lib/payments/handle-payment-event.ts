import * as Sentry from "@sentry/node";
import { randomUUID } from "node:crypto";
import {
  getMembership,
  setAwaitingSubscription,
  setActive,
  setCancelled,
  setPaymentFailed,
} from "../memberships";
import { appendCheckoutLog, updateBasicApplicationStatus } from "../google-sheets";
import { getApplicantById, markApplicantPaid } from "../upload-sheet";
import {
  appendRenewal,
  getRenewalById,
  getRenewalByPaymentRef,
  markRenewalPaid,
  getRenewalsSheetUrl,
} from "../renewal-sheet";
import { getTier, TIERS } from "../forms/tiers";
import { TIMEZONE } from "../config";
import { getPublicAppUrl } from "../staging";
import {
  createAdvancedApplicationReviewDoc,
  createBasicApplicationReviewDoc,
  refreshAdvancedIndexDoc,
  refreshBasicIndexDoc,
} from "../google-docs";
import {
  sendAdvancedConfirmation,
  sendAdvancedApplicationNotification,
  sendBasicConfirmation,
  sendBasicApplicationNotification,
  sendRenewalPdLogLink,
  sendRenewalAdminNotification,
} from "../email-sender";
import { getRecipientsForEvent } from "../notification-rules";
import type { PaymentEvent, PaymentLogger, PaymentProvider } from "./types";

type Of<T extends PaymentEvent["type"]> = Extract<PaymentEvent, { type: T }>;

// Initialize Sentry lazily — only when DSN is present
export function getSentry() {
  if (process.env.SENTRY_DSN && !Sentry.isInitialized()) {
    Sentry.init({ dsn: process.env.SENTRY_DSN });
  }
  return Sentry;
}

/**
 * Domain side effects for a verified, provider-neutral payment event.
 * Provider-specific parsing lives in the adapter; nothing here imports a
 * provider SDK.
 */
export async function handlePaymentEvent(
  event: PaymentEvent,
  provider: PaymentProvider,
  log: PaymentLogger,
): Promise<void> {
  switch (event.type) {
    case "checkout_completed":
      return handleCheckoutCompleted(event, provider, log);
    case "renewal_charged":
      return handleRenewalCharged(event, log);
    case "renewal_failed":
      return handleRenewalFailed(event, log);
    case "subscription_updated":
    case "subscription_cancelled":
      return handleSubscriptionEvent(event, log);
  }
}

/**
 * Option C (one-time first-term payment):
 * - Checkout charged the first term as a one-time payment
 * - The provider then creates the recurring subscription with its first
 *   charge at the next renewal anchor date (idempotent per checkout)
 */
async function handleCheckoutCompleted(
  event: Of<"checkout_completed">,
  provider: PaymentProvider,
  log: PaymentLogger,
): Promise<void> {
  const sessionId = event.checkoutRef;
  const metadata = event.metadata;

  // Renewal flow: one-time payment, no subscription
  if (metadata.flow === "renewal") {
    const renewalId = metadata.renewal_id ?? undefined;
    if (!renewalId) {
      log.warn("renewal_missing_id", { sessionId });
      return;
    }
    const renewal = await getRenewalById(renewalId);
    if (!renewal) {
      log.warn("renewal_not_found", { sessionId, renewalId });
      return;
    }
    if (renewal.paymentStatus === "paid") {
      log.info("renewal_skip_already_paid", { sessionId, renewalId });
      return;
    }
    const paidAt = new Date().toISOString();
    await markRenewalPaid(renewalId, sessionId, paidAt);

    void appendCheckoutLog({
      timestamp: paidAt,
      firstName: renewal.firstName,
      lastName: renewal.lastName,
      phone: renewal.phone,
      email: renewal.email,
      plan: `renewal_${renewal.tier}`,
      amountPaid: renewal.amountPaidCents,
      sessionId,
      customerId: event.customerRef ?? "",
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("renewal_checkout_log_failed", { err: msg, renewalId });
    });

    log.info("renewal_marked_paid", { renewalId, sessionId, tier: renewal.tier });

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

    return;
  }

  // Only handle Option C flow
  if (metadata.flow !== "option_c") return;

  const recurringPriceId = metadata.recurring_price_id;
  const plan = metadata.plan;
  const nextJuly1Epoch = parseInt(metadata.next_july1_epoch ?? "0", 10);
  const customerId = event.customerRef ?? undefined;

  if (!customerId || !recurringPriceId) {
    log.warn("checkout_completed.missing_metadata", {
      customerId,
      recurringPriceId,
      sessionId,
    });
    return;
  }

  // Already processed this checkout session? The durable mirror is a
  // fast-path guard only — the provider idempotency key on subscription
  // creation is the real safety mechanism, so a wiped/missing mirror
  // row can never cause a duplicate subscription.
  const existing = await getMembership(customerId);
  const alreadyProcessed = !!existing?.subscriptionId;
  if (alreadyProcessed) {
    log.info("checkout_completed.already_processed", {
      customerId,
      sessionId,
      existingSubscriptionId: existing.subscriptionId,
    });
  }

  if (!alreadyProcessed) {
    let subscriptionId: string;
    try {
      const subscription = await provider.ensureSubscription(
        {
          checkoutRef: sessionId,
          customerRef: customerId,
          paymentRef: event.paymentRef,
          priceRef: recurringPriceId,
          anchorEpoch: nextJuly1Epoch,
          plan: plan ?? "",
        },
        log,
      );
      subscriptionId = subscription.subscriptionRef;
      log.info("checkout_completed.subscription_created", {
        customerId,
        sessionId,
        subscriptionId,
        plan,
        recurringPriceId,
        trialEndEpoch: nextJuly1Epoch,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const sentry = getSentry();
      sentry.captureException(err, {
        extra: { customerId, sessionId, recurringPriceId, plan },
      });
      log.error("checkout_completed.subscription_create_failed", {
        customerId,
        sessionId,
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
      provider: event.provider,
    }, sessionId);

    // Mark as active since subscription is now set up
    await setActive(customerId, subscriptionId, sessionId, event.provider);
  }

  // Mark professional applicant paid/complete in the application sheet.
  const applicantId = metadata.applicant_id;
  let advancedApplicant = null;
  if (plan === "advanced" && applicantId) {
    await markApplicantPaid(applicantId, sessionId);
    log.info("checkout_completed.applicant_marked_paid", {
      applicantId,
      sessionId,
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
          sessionId,
          error: msg,
        });
      });
    } else {
      log.warn("checkout_completed.missing_applicant_email_for_confirmation", {
        applicantId,
        sessionId,
      });
    }
  }

  // Log to Google Sheets (async — don't fail the webhook if this errors)
  appendCheckoutLog({
    timestamp: new Date().toISOString(),
    firstName: metadata.first_name ?? "",
    lastName: metadata.last_name ?? "",
    phone: metadata.phone ?? "",
    email: event.customerEmail ?? "",
    plan: plan || "",
    amountPaid: event.amountTotal,
    sessionId,
    customerId,
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    const sentry = getSentry();
    sentry.captureException(err, {
      extra: { customerId, sessionId },
      level: "warning",
    });
    log.error("checkout_completed.sheets_log_failed", {
      customerId,
      sessionId,
      error: msg,
    });
  });

  // Create a Google Doc review document for professional applications
  if (plan === "advanced" && applicantId && advancedApplicant) {
    const applicant = advancedApplicant;
    createAdvancedApplicationReviewDoc(applicant).then(async (docUrl: string) => {
      const membershipEmail = process.env.SUPPORT_EMAIL?.trim() || "membership@example.com";
      const applicantFullName = `${applicant.firstName} ${applicant.lastName}`;
      const recipients = await getRecipientsForEvent("advanced_payment_received", membershipEmail);
      recipients.forEach((to) => {
        sendAdvancedApplicationNotification(to, applicantFullName, docUrl, applicantId).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          log.error("checkout_completed.internal_notification_failed", {
            applicantId,
            sessionId,
            error: msg,
          });
        });
      });
      // Refresh PM index doc
      refreshAdvancedIndexDoc().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("checkout_completed.pm_index_refresh_failed", { applicantId, sessionId, error: msg });
      });
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("checkout_completed.review_doc_failed", {
        applicantId,
        sessionId,
        error: msg,
      });
    });
  } else if (plan === "advanced" && applicantId) {
    log.warn("checkout_completed.applicant_not_found_for_review_doc", {
      applicantId,
      sessionId,
    });
  }

  // Create a Google Doc review document for associate applications
  const basicApplicationId = metadata.basic_application_id;
  const associateListOnPage = metadata.list_on_page ?? "";
  if (plan === "basic" && basicApplicationId) {
    // Flip the sheet row's checkout_status from "checkout_requested" to
    // "paid". Replay-safe (fixed-state write) and non-blocking.
    updateBasicApplicationStatus(basicApplicationId, "paid")
      .then((updated) => {
        log.info(
          updated
            ? "checkout_completed.basic_application_marked_paid"
            : "checkout_completed.basic_application_not_found",
          { basicApplicationId, sessionId },
        );
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("checkout_completed.basic_application_update_failed", {
          basicApplicationId,
          sessionId,
          error: msg,
        });
      });

    const associateDocData = {
      applicationId: basicApplicationId,
      submittedAt: "",
      firstName: metadata.first_name ?? "",
      lastName: metadata.last_name ?? "",
      email: event.customerEmail ?? "",
      phone: metadata.phone ?? "",
      fullAddress: metadata.full_address ?? "",
      postalAddress: metadata.postal_address ?? "",
      businessName: metadata.business_name ?? "",
      interestJoining: metadata.interest_joining ?? "",
      trainingDetails: metadata.training_details ?? "",
      listOnPage: associateListOnPage,
      listingDetails: metadata.listing_details ?? "",
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
          sessionId,
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
            sessionId,
            error: msg,
          });
        });
      });
      // Refresh AM index doc
      refreshBasicIndexDoc().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("checkout_completed.am_index_refresh_failed", { basicApplicationId, sessionId, error: msg });
      });
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("checkout_completed.associate_review_doc_failed", {
        basicApplicationId,
        sessionId,
        error: msg,
      });
    });
  }
}

/**
 * Records automatic renewals (spec 005 REQ-MR-009/-010, spec 008 acceptance
 * criterion 3). Option C year 2+: the deferred subscription's trial ends at
 * the anchor date, the provider charges the saved card and emits a renewal
 * event. The auto-renewal joins the manual-renewal rails: one Renewals-sheet
 * ledger, machine- and member-created rows side by side, so every downstream
 * flow (admin notification, advanced PD-log link, future Xero trigger) keys
 * off the same rows.
 *
 * The adapter has already filtered to real anchor-date cycle charges with a
 * non-zero amount; `flow`/`plan` live on the subscription's metadata.
 */
async function handleRenewalCharged(
  event: Of<"renewal_charged">,
  log: PaymentLogger,
): Promise<void> {
  const { providerRef, customerRef, subscriptionRef } = event;
  const subMeta = event.subscriptionMetadata;
  if (subMeta.flow !== "option_c") {
    log.info("invoice.paid.skip_flow", {
      invoiceId: providerRef,
      flow: subMeta.flow ?? "(none)",
    });
    return;
  }

  // D4 — idempotency at the ledger boundary: the provider reference lives in
  // the Renewals row's payment_ref column (semantically "the payment
  // reference"). Replay of the same charge → no duplicate row.
  const existing = await getRenewalByPaymentRef(providerRef);
  if (existing) {
    log.info("invoice.paid.already_recorded", {
      invoiceId: providerRef,
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
    log.warn("invoice.paid.unknown_plan_metadata", { invoiceId: providerRef, plan });
    tier = TIERS.basic.storageValue;
  }
  const fullName = event.customerName.trim();
  const splitAt = fullName.lastIndexOf(" ");
  const firstName = splitAt === -1 ? fullName : fullName.slice(0, splitAt);
  const lastName = splitAt === -1 ? "" : fullName.slice(splitAt + 1);
  // Membership year being paid for = year of the line-period START in the
  // org's timezone (matches manual-renewal semantics, REQ-MR-003).
  const year = Number(
    new Intl.DateTimeFormat("en", { timeZone: TIMEZONE, year: "numeric" }).format(
      new Date(event.periodStartEpoch * 1000),
    ),
  );
  const paidAt = new Date().toISOString();
  const renewalId = randomUUID();

  // D6 — the Renewals append is the synchronous critical write. A failure
  // THROWS: the route's error path returns 500, the provider retries, and the
  // D4 dedupe makes the retry safe.
  await appendRenewal({
    renewalId,
    tier,
    year,
    firstName,
    lastName,
    email: event.customerEmail,
    phone: "",
    pdEntries: [],
    amountCents: event.amount,
    currency: event.currency,
    paymentRef: providerRef,
    paymentStatus: "paid",
    createdAt: paidAt,
    paidAt,
  });
  log.info("invoice.paid.auto_renewal_recorded", {
    invoiceId: providerRef,
    renewalId,
    customerId: customerRef,
    tier,
    year,
    amountCents: event.amount,
  });

  // D6 — everything below is async fire-and-forget, individually logged.
  const adminEmail = process.env.ADMIN_EMAIL?.trim() || "admin@example.com";
  const adminTier = tier === "basic" ? "basic" : "adv";
  sendRenewalAdminNotification(
    adminEmail,
    adminTier,
    fullName,
    event.customerEmail,
    renewalId,
    event.amount,
    getRenewalsSheetUrl(),
  ).catch((err) => {
    log.error("invoice.paid.admin_notification_failed", {
      renewalId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  if (tier === "adv" && event.customerEmail) {
    const pdLogLink = `${getPublicAppUrl()}/renew/pd-log?token=${renewalId}`;
    sendRenewalPdLogLink(event.customerEmail, fullName, pdLogLink, renewalId).catch((err) => {
      log.error("invoice.paid.pd_link_failed", {
        renewalId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // Durable mirror (REQ-SW-008) — also self-heals a prior payment_failed.
  setActive(customerRef, subscriptionRef, providerRef, event.provider).catch((err) => {
    log.error("invoice.paid.set_active_failed", {
      customerId: customerRef,
      subscriptionId: subscriptionRef,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Spec 016 hook lands here when the Xero adapter ships:
  // recordPaymentInXero(mapEventToLedgerPayment(event, tier, year)) — F&F.
}

async function handleRenewalFailed(
  event: Of<"renewal_failed">,
  log: PaymentLogger,
): Promise<void> {
  if (event.metadata.flow !== "option_c") return;

  await setPaymentFailed(event.customerRef, event.providerRef || undefined, event.provider);
  log.warn("invoice.payment_failed", {
    customerId: event.customerRef,
    invoiceId: event.providerRef,
  });
}

async function handleSubscriptionEvent(
  event: Of<"subscription_updated"> | Of<"subscription_cancelled">,
  log: PaymentLogger,
): Promise<void> {
  if (event.metadata.flow !== "option_c") return;

  if (event.type === "subscription_cancelled") {
    await setCancelled(event.customerRef, event.subscriptionRef, event.provider);
    log.info("subscription.cancelled", {
      customerId: event.customerRef,
      subscriptionId: event.subscriptionRef,
      status: event.status,
    });
  } else {
    log.info("subscription.updated", {
      customerId: event.customerRef,
      subscriptionId: event.subscriptionRef,
      status: event.status,
    });
  }
}
