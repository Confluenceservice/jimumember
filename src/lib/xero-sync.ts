import { logger } from "./logger";
import {
  XeroApiError,
  createContact,
  createInvoice,
  createPayment,
  findContactByNumber,
  findInvoiceByNumber,
} from "./xero-client";
import {
  appendPending,
  findByStripeId,
  listPending,
  markAttemptFailed,
  markDone,
  type XeroSyncFlow,
  type XeroSyncRecord,
  type XeroSyncRow,
} from "./xero-sync-sheet";
import { TIERS } from "./forms/tiers";

/**
 * Orchestrates Stripe payment -> Xero Contact + paid Invoice.
 *
 * The single hard rule: enqueueAndPush NEVER rejects. A 500 out of
 * stripe-webhook.ts makes Stripe replay the event and re-fire the whole
 * side-effect chain — another Google Doc, another confirmation email,
 * another admin notification. Not all of those are idempotent, so a Xero
 * outage must cost us a pending row, nothing more.
 */

/**
 * Invoice line descriptions. Derived from the tier labels so a fork that
 * renames its tiers gets matching Xero invoices for free — unlike the flow
 * KEYS, which are a stored contract and must not change.
 */
const FLOW_LABELS: Record<XeroSyncFlow, string> = {
  advanced_new: TIERS.advanced.label,
  basic_new: TIERS.basic.label,
  renewal: "Membership renewal",
  auto_renewal: "Membership renewal",
};

export function isXeroEnabled(): boolean {
  const raw = process.env.XERO_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

/**
 * First layer of the environment guard (the tenant check in xero-auth is
 * the second). Refuses to act when the Stripe event's livemode disagrees
 * with this deployment's XERO_ALLOW_LIVE — a test-mode webhook must never
 * reach the production Xero org, and a live payment must never land in the
 * demo org. Throws rather than returning false so a misconfiguration is
 * loud in the logs instead of silently dropping revenue.
 */
export function assertEnvironmentSafe(livemode: boolean): void {
  const allowLive = process.env.XERO_ALLOW_LIVE?.trim().toLowerCase() === "true";
  if (livemode !== allowLive) {
    throw new Error(
      `XERO_ENV_GUARD: event livemode=${livemode} but XERO_ALLOW_LIVE=${allowLive}`,
    );
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_CONFIG: ${name}`);
  return value;
}

/** Xero wants a plain calendar date; the ISO timestamp's date half is it. */
function xeroDate(iso: string): string {
  const date = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new XeroApiError(`XERO_BAD_DATE: cannot derive a Xero date from "${iso}"`, 400, true);
  }
  return date;
}

function invoicePayload(record: XeroSyncRecord, contactId: string): Record<string, unknown> {
  const date = xeroDate(record.paidAt);
  return {
    Type: "ACCREC",
    Contact: { ContactID: contactId },
    Date: date,
    DueDate: date,
    // Deterministic: this is what makes a re-drive idempotent.
    InvoiceNumber: record.stripeId,
    Reference: `${record.flow}/${record.internalId}`,
    // The blueprint assumes a sales-tax-exempt org: the invoice total must
    // equal the Stripe gross to the cent, or the payment part-allocates and
    // the Stripe clearing account never nets to zero. A tax-registered fork
    // changes this AND `XERO_TAX_TYPE` together — see docs/CUSTOMIZE.md.
    LineAmountTypes: "NoTax",
    Status: "AUTHORISED",
    LineItems: [
      {
        Description: `${FLOW_LABELS[record.flow] ?? record.flow} ${date.slice(0, 4)}`,
        Quantity: 1,
        UnitAmount: record.amountCents / 100,
        AccountCode: requireEnv("XERO_SALES_ACCOUNT_CODE"),
        // Env-overridable: valid TaxTypes vary by Xero region, so confirm
        // yours with GET /TaxRates before going live (runbook step 1).
        TaxType: process.env.XERO_TAX_TYPE?.trim() || "NONE",
      },
    ],
  };
}

function paymentPayload(record: XeroSyncRecord, invoiceId: string): Record<string, unknown> {
  return {
    Invoice: { InvoiceID: invoiceId },
    // The Stripe FEED clearing account, never the real bank account. The
    // feed's imported charge lines are what match against these payments.
    Account: { AccountID: requireEnv("XERO_STRIPE_FEED_ACCOUNT_ID") },
    // The BALANCE TRANSACTION date, not today. A payment dated in a
    // different period from the feed line will not auto-match.
    Date: xeroDate(record.paidAt),
    Amount: record.amountCents / 100,
    Reference: record.stripeId,
  };
}

/** True once Xero considers the invoice settled. */
function isFullyPaid(amountDue: number | undefined, payments: unknown[] | undefined): boolean {
  if (typeof amountDue === "number") return amountDue === 0;
  return Array.isArray(payments) && payments.length > 0;
}

/**
 * Pushes one record to Xero. Idempotent by design, and RESUMABLE: the
 * process can die between createInvoice and createPayment, which would
 * otherwise leave an AUTHORISED invoice with no payment — the clearing
 * account would never net to zero while the sweeper happily reported done.
 *
 * Throws on failure. Callers decide what that means for the sheet row.
 */
export async function pushOne(record: XeroSyncRecord): Promise<void> {
  const existing = await findInvoiceByNumber(record.stripeId);

  if (existing) {
    if (isFullyPaid(existing.AmountDue, existing.Payments)) {
      logger.info("xero_sync.already_complete", {
        stripeId: record.stripeId,
        invoiceId: existing.InvoiceID,
      });
      await markDone(record.stripeId, {
        invoiceId: existing.InvoiceID,
        paymentId: existing.Payments?.[0]?.PaymentID,
      });
      return;
    }

    // Invoice exists but is unpaid — resume at the payment step rather than
    // creating a second invoice.
    logger.warn("xero_sync.resuming_unpaid_invoice", {
      stripeId: record.stripeId,
      invoiceId: existing.InvoiceID,
      amountDue: existing.AmountDue,
    });
    const payment = await createPayment(paymentPayload(record, existing.InvoiceID));
    await markDone(record.stripeId, {
      invoiceId: existing.InvoiceID,
      paymentId: payment.PaymentID,
    });
    return;
  }

  // KNOWN GAP: same-name Contact handling. Xero's uniqueness behaviour on
  // Name has not been confirmed against a real org, so there is no
  // retry-with-suffixed-name branch here — guessing the constraint would
  // bake in a workaround for a failure mode that may not exist in this
  // shape. Two members with the same name and different emails is the
  // reproduction; implement whatever that observation requires.
  const contact =
    (await findContactByNumber(record.email)) ??
    (await createContact({
      Name: record.contactName || record.email,
      EmailAddress: record.email,
      ContactNumber: record.email,
    }));

  const invoice = await createInvoice(invoicePayload(record, contact.ContactID));
  const payment = await createPayment(paymentPayload(record, invoice.InvoiceID));

  await markDone(record.stripeId, {
    contactId: contact.ContactID,
    invoiceId: invoice.InvoiceID,
    paymentId: payment.PaymentID,
  });
  logger.info("xero_sync.pushed", {
    stripeId: record.stripeId,
    flow: record.flow,
    invoiceId: invoice.InvoiceID,
  });
}

function describeError(err: unknown): { message: string; permanent: boolean } {
  if (err instanceof XeroApiError) {
    return { message: err.message, permanent: err.permanent };
  }
  const message = err instanceof Error ? err.message : String(err);
  // MISSING_CONFIG is an operator error: retrying hourly will not fix an
  // unset account code, and a stuck pending row hides it.
  const permanent = message.startsWith("MISSING_CONFIG");
  return { message, permanent };
}

/**
 * The webhook entry point. Records the payment durably, then attempts the
 * push inline (three API calls, comfortably inside Stripe's timeout).
 *
 * Resolves in EVERY path — see the module header.
 */
export async function enqueueAndPush(record: XeroSyncRecord): Promise<void> {
  if (!isXeroEnabled()) return;

  try {
    assertEnvironmentSafe(record.livemode);
  } catch (err) {
    // Deliberately before appendPending: a wrong-environment event should
    // leave no trace for the sweeper to pick up later.
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("xero_sync.environment_guard_blocked", {
      stripeId: record.stripeId,
      error: msg,
    });
    return;
  }

  await appendPending(record);

  try {
    await pushOne(record);
  } catch (err) {
    const { message, permanent } = describeError(err);
    logger.error("xero_sync.push_failed", {
      stripeId: record.stripeId,
      permanent,
      error: message,
    });
    await markAttemptFailed(record.stripeId, message, permanent);
  }
}

export interface SweepResult {
  swept: number;
  done: number;
  stillPending: number;
  permanentFailures: number;
}

function rowToRecord(row: XeroSyncRow): XeroSyncRecord {
  return {
    stripeId: row.stripeId,
    eventType: row.eventType,
    flow: row.flow,
    internalId: row.internalId,
    email: row.email,
    contactName: row.contactName,
    amountCents: row.amountCents,
    currency: row.currency,
    paidAt: row.paidAt,
    feeCents: row.feeCents,
    livemode: row.livemode,
  };
}

/**
 * Re-drives pending rows. Sequential on purpose: one 256 MB machine, and
 * Xero rate-limits per tenant, so parallelism here buys 429s.
 *
 * Each row is re-checked against its stored livemode, so a sweep can never
 * push a row belonging to the other environment even if both share a
 * spreadsheet.
 */
export async function sweepPending(limit = 20): Promise<SweepResult> {
  const result: SweepResult = { swept: 0, done: 0, stillPending: 0, permanentFailures: 0 };
  if (!isXeroEnabled()) return result;

  const rows = await listPending(limit);
  for (const row of rows) {
    result.swept++;
    try {
      assertEnvironmentSafe(row.livemode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("xero_sync.sweep_skipped_wrong_environment", {
        stripeId: row.stripeId,
        error: msg,
      });
      result.stillPending++;
      continue;
    }

    try {
      await pushOne(rowToRecord(row));
      result.done++;
    } catch (err) {
      const { message, permanent } = describeError(err);
      logger.error("xero_sync.sweep_push_failed", {
        stripeId: row.stripeId,
        permanent,
        error: message,
      });
      await markAttemptFailed(row.stripeId, message, permanent);
      if (permanent) result.permanentFailures++;
      else result.stillPending++;
    }
  }

  logger.info("xero_sync.sweep_completed", { ...result });
  return result;
}

export { findByStripeId };
