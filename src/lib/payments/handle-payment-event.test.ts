import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getMembership: vi.fn(),
  setAwaitingSubscription: vi.fn(),
  setActive: vi.fn(),
  setCancelled: vi.fn(),
  setPaymentFailed: vi.fn(),
  appendCheckoutLog: vi.fn(),
  updateBasicApplicationStatus: vi.fn(),
  getApplicantById: vi.fn(),
  markApplicantPaid: vi.fn(),
  getRenewalById: vi.fn(),
  getRenewalByStripeRef: vi.fn(),
  markRenewalPaid: vi.fn(),
  appendRenewal: vi.fn(),
  sendRenewalAdminNotification: vi.fn(),
  sendRenewalPdLogLink: vi.fn(),
  getRecipientsForEvent: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("../memberships", () => ({
  getMembership: m.getMembership,
  setAwaitingSubscription: m.setAwaitingSubscription,
  setActive: m.setActive,
  setCancelled: m.setCancelled,
  setPaymentFailed: m.setPaymentFailed,
}));
vi.mock("../google-sheets", () => ({
  appendCheckoutLog: m.appendCheckoutLog,
  updateBasicApplicationStatus: m.updateBasicApplicationStatus,
}));
vi.mock("../upload-sheet", () => ({
  getApplicantById: m.getApplicantById,
  markApplicantPaid: m.markApplicantPaid,
}));
vi.mock("../renewal-sheet", () => ({
  getRenewalById: m.getRenewalById,
  getRenewalByStripeRef: m.getRenewalByStripeRef,
  markRenewalPaid: m.markRenewalPaid,
  appendRenewal: m.appendRenewal,
  getRenewalsSheetUrl: vi.fn().mockReturnValue(undefined),
}));
vi.mock("../email-sender", () => ({
  sendAdvancedConfirmation: vi.fn().mockResolvedValue(undefined),
  sendAdvancedApplicationNotification: vi.fn().mockResolvedValue(undefined),
  sendBasicConfirmation: vi.fn().mockResolvedValue(undefined),
  sendBasicApplicationNotification: vi.fn().mockResolvedValue(undefined),
  sendRenewalPdLogLink: m.sendRenewalPdLogLink,
  sendRenewalAdminNotification: m.sendRenewalAdminNotification,
}));
vi.mock("../google-docs", () => ({
  createAdvancedApplicationReviewDoc: vi.fn().mockResolvedValue("https://docs.test/d"),
  createBasicApplicationReviewDoc: vi.fn().mockResolvedValue("https://docs.test/d"),
  refreshAdvancedIndexDoc: vi.fn().mockResolvedValue(undefined),
  refreshBasicIndexDoc: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../notification-rules", () => ({ getRecipientsForEvent: m.getRecipientsForEvent }));
vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  isInitialized: vi.fn().mockReturnValue(true),
  captureException: m.captureException,
}));

import { handlePaymentEvent } from "./handle-payment-event";
import type { PaymentEvent, PaymentProvider } from "./types";

const log: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const ensureSubscription = vi.fn();
const provider = { id: "stripe", ensureSubscription } as unknown as PaymentProvider;

type Checkout = Extract<PaymentEvent, { type: "checkout_completed" }>;
type Charged = Extract<PaymentEvent, { type: "renewal_charged" }>;

const checkout = (over: Partial<Checkout> = {}): Checkout => ({
  type: "checkout_completed",
  provider: "stripe",
  checkoutRef: "cs_1",
  paymentRef: "pi_1",
  customerRef: "cus_1",
  customerEmail: "jane@example.com",
  amountTotal: 5000,
  paidAt: "2026-01-01T00:00:00.000Z",
  metadata: {
    flow: "option_c",
    plan: "basic",
    recurring_price_id: "price_1",
    next_july1_epoch: "1782864000",
    first_name: "Jane",
    last_name: "Doe",
  },
  ...over,
});

const charged = (over: Partial<Charged> = {}): Charged => ({
  type: "renewal_charged",
  provider: "stripe",
  providerRef: "in_1",
  customerRef: "cus_1",
  subscriptionRef: "sub_1",
  amount: 15000,
  currency: "usd",
  customerName: "Jane van Doe",
  customerEmail: "jane@example.com",
  periodStartEpoch: 1782864000,
  paidAt: "2026-07-01T00:00:00.000Z",
  subscriptionMetadata: { flow: "option_c", plan: "advanced" },
  ...over,
});

describe("handlePaymentEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUBLIC_APP_URL = "https://app.test";
    ensureSubscription.mockResolvedValue({ subscriptionRef: "sub_1" });
    m.getMembership.mockResolvedValue(null);
    m.setAwaitingSubscription.mockResolvedValue(undefined);
    m.setActive.mockResolvedValue(undefined);
    m.appendCheckoutLog.mockResolvedValue(undefined);
    m.updateBasicApplicationStatus.mockResolvedValue(true);
    m.getRenewalByStripeRef.mockResolvedValue(null);
    m.appendRenewal.mockResolvedValue(undefined);
    m.sendRenewalAdminNotification.mockResolvedValue(undefined);
    m.sendRenewalPdLogLink.mockResolvedValue(undefined);
    m.getRecipientsForEvent.mockImplementation(async (_e: string, fb?: string) => (fb ? [fb] : []));
  });

  it("renewal checkout marks the renewal paid with the checkout ref", async () => {
    m.getRenewalById.mockResolvedValue({
      renewalId: "r1", paymentStatus: "pending", firstName: "J", lastName: "D",
      phone: "", email: "j@x.test", tier: "basic", amountPaidCents: 7500,
    });
    m.markRenewalPaid.mockResolvedValue(undefined);
    await handlePaymentEvent(
      checkout({ metadata: { flow: "renewal", renewal_id: "r1" } }),
      provider,
      log,
    );
    expect(m.markRenewalPaid).toHaveBeenCalledWith("r1", "cs_1", expect.any(String));
    expect(ensureSubscription).not.toHaveBeenCalled();
  });

  it("an already-paid renewal is skipped", async () => {
    m.getRenewalById.mockResolvedValue({ renewalId: "r1", paymentStatus: "paid" });
    await handlePaymentEvent(checkout({ metadata: { flow: "renewal", renewal_id: "r1" } }), provider, log);
    expect(m.markRenewalPaid).not.toHaveBeenCalled();
  });

  it("option_c checkout calls ensureSubscription, then records awaiting + active", async () => {
    await handlePaymentEvent(checkout(), provider, log);
    expect(ensureSubscription).toHaveBeenCalledWith(
      {
        checkoutRef: "cs_1",
        customerRef: "cus_1",
        paymentRef: "pi_1",
        priceRef: "price_1",
        anchorEpoch: 1782864000,
        plan: "basic",
      },
      log,
    );
    expect(m.setAwaitingSubscription).toHaveBeenCalledWith(
      "cus_1",
      expect.objectContaining({ plan: "basic", recurringPriceId: "price_1", nextJuly1Epoch: 1782864000, subscriptionId: "sub_1" }),
      "cs_1",
    );
    expect(m.setActive).toHaveBeenCalledWith("cus_1", "sub_1", "cs_1");
  });

  it("skips ensureSubscription when the membership already has a subscription", async () => {
    m.getMembership.mockResolvedValue({ subscriptionId: "sub_existing" });
    await handlePaymentEvent(checkout(), provider, log);
    expect(ensureSubscription).not.toHaveBeenCalled();
    expect(m.setActive).not.toHaveBeenCalled();
  });

  it("ensureSubscription failure is captured and rethrown", async () => {
    ensureSubscription.mockRejectedValue(new Error("stripe down"));
    await expect(handlePaymentEvent(checkout(), provider, log)).rejects.toThrow("stripe down");
    expect(m.captureException).toHaveBeenCalled();
    expect(m.setAwaitingSubscription).not.toHaveBeenCalled();
  });

  it("checkout without a customer or recurring price is ignored", async () => {
    await handlePaymentEvent(checkout({ customerRef: null }), provider, log);
    await handlePaymentEvent(
      checkout({ metadata: { flow: "option_c", plan: "basic", recurring_price_id: "" } }),
      provider,
      log,
    );
    expect(ensureSubscription).not.toHaveBeenCalled();
  });

  it("a basic application checkout flips the sheet row's checkout_status to paid", async () => {
    await handlePaymentEvent(
      checkout({
        metadata: {
          flow: "option_c", plan: "basic", recurring_price_id: "price_1",
          next_july1_epoch: "1782864000", basic_application_id: "assoc_1",
        },
      }),
      provider,
      log,
    );
    expect(m.updateBasicApplicationStatus).toHaveBeenCalledWith("assoc_1", "paid");
  });

  it("a checkout whose flow is neither renewal nor option_c is ignored", async () => {
    await handlePaymentEvent(checkout({ metadata: { flow: "other" } }), provider, log);
    expect(ensureSubscription).not.toHaveBeenCalled();
    expect(m.getRenewalById).not.toHaveBeenCalled();
  });

  it("renewal_charged appends one Renewals row; a replay of the same invoice appends nothing", async () => {
    await handlePaymentEvent(charged(), provider, log);
    expect(m.appendRenewal).toHaveBeenCalledTimes(1);
    expect(m.appendRenewal).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "adv",
        year: 2026,
        firstName: "Jane van",
        lastName: "Doe",
        email: "jane@example.com",
        amountCents: 15000,
        currency: "usd",
        stripeSession: "in_1",
        paymentStatus: "paid",
      }),
    );
    expect(m.setActive).toHaveBeenCalledWith("cus_1", "sub_1", "in_1");

    m.getRenewalByStripeRef.mockResolvedValue({ renewalId: "existing" });
    m.appendRenewal.mockClear();
    await handlePaymentEvent(charged(), provider, log);
    expect(m.appendRenewal).not.toHaveBeenCalled();
  });

  it("renewal_charged for a non-option_c subscription is ignored", async () => {
    await handlePaymentEvent(charged({ subscriptionMetadata: { flow: "other" } }), provider, log);
    expect(m.appendRenewal).not.toHaveBeenCalled();
  });

  it("a failing Renewals append rejects so the provider retries", async () => {
    m.appendRenewal.mockRejectedValue(new Error("sheet down"));
    await expect(handlePaymentEvent(charged(), provider, log)).rejects.toThrow("sheet down");
  });

  it("renewal_failed only acts on option_c metadata", async () => {
    const failed = { type: "renewal_failed", provider: "stripe", providerRef: "in_9", customerRef: "cus_1" } as const;
    await handlePaymentEvent({ ...failed, metadata: {} }, provider, log);
    expect(m.setPaymentFailed).not.toHaveBeenCalled();
    await handlePaymentEvent({ ...failed, metadata: { flow: "option_c" } }, provider, log);
    expect(m.setPaymentFailed).toHaveBeenCalledWith("cus_1", "in_9");
  });

  it("subscription_cancelled marks the membership cancelled; non-option_c is ignored", async () => {
    const cancelled = {
      type: "subscription_cancelled", provider: "stripe", subscriptionRef: "sub_1",
      customerRef: "cus_1", status: "canceled",
    } as const;
    await handlePaymentEvent({ ...cancelled, metadata: { flow: "other" } }, provider, log);
    expect(m.setCancelled).not.toHaveBeenCalled();
    await handlePaymentEvent({ ...cancelled, metadata: { flow: "option_c" } }, provider, log);
    expect(m.setCancelled).toHaveBeenCalledWith("cus_1", "sub_1");
  });

  it("subscription_updated never cancels", async () => {
    await handlePaymentEvent(
      { type: "subscription_updated", provider: "stripe", subscriptionRef: "sub_1", customerRef: "cus_1", status: "active", metadata: { flow: "option_c" } },
      provider,
      log,
    );
    expect(m.setCancelled).not.toHaveBeenCalled();
  });
});
