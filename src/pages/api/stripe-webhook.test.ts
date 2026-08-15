import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

const mockSendAdvancedConfirmation = vi.fn();
const mockSendAdvancedApplicationNotification = vi.fn();
const mockSendBasicConfirmation = vi.fn();
const mockSendBasicApplicationNotification = vi.fn();
const mockSendRenewalPdLogLink = vi.fn();
const mockSendRenewalAdminNotification = vi.fn();
const mockAppendCheckoutLog = vi.fn();
const mockCreateAdvancedApplicationReviewDoc = vi.fn();
const mockCreateBasicApplicationReviewDoc = vi.fn();
const mockGetMembership = vi.fn();
const mockHasActiveSubscription = vi.fn();
const mockSetAwaitingSubscription = vi.fn();
const mockSetActive = vi.fn();
const mockSetCancelled = vi.fn();
const mockSetPaymentFailed = vi.fn();
const mockGetApplicantById = vi.fn();
const mockMarkApplicantPaid = vi.fn();
const mockMarkRenewalPaid = vi.fn();
const mockGetRenewalById = vi.fn();
const mockGetRenewalByStripeRef = vi.fn();
const mockAppendRenewal = vi.fn();
const mockGetRecipientsForEvent = vi.fn();
const mockEnqueueAndPush = vi.fn();
const mockIsXeroEnabled = vi.fn();
const mockGetPaymentFacts = vi.fn();

vi.mock("../../lib/email-sender", () => ({
  sendAdvancedConfirmation: mockSendAdvancedConfirmation,
  sendAdvancedApplicationNotification: mockSendAdvancedApplicationNotification,
  sendBasicConfirmation: mockSendBasicConfirmation,
  sendBasicApplicationNotification: mockSendBasicApplicationNotification,
  sendRenewalPdLogLink: mockSendRenewalPdLogLink,
  sendRenewalAdminNotification: mockSendRenewalAdminNotification,
}));

vi.mock("../../lib/google-sheets", () => ({
  appendCheckoutLog: mockAppendCheckoutLog,
}));

vi.mock("../../lib/notification-rules", () => ({
  getRecipientsForEvent: mockGetRecipientsForEvent,
}));

vi.mock("../../lib/google-docs", () => ({
  createAdvancedApplicationReviewDoc: mockCreateAdvancedApplicationReviewDoc,
  createBasicApplicationReviewDoc: mockCreateBasicApplicationReviewDoc,
}));

vi.mock("../../lib/memberships", () => ({
  getMembership: mockGetMembership,
  hasActiveSubscription: mockHasActiveSubscription,
  setAwaitingSubscription: mockSetAwaitingSubscription,
  setActive: mockSetActive,
  setCancelled: mockSetCancelled,
  setPaymentFailed: mockSetPaymentFailed,
}));

vi.mock("../../lib/upload-sheet", () => ({
  getApplicantById: mockGetApplicantById,
  markApplicantPaid: mockMarkApplicantPaid,
}));

vi.mock("../../lib/renewal-sheet", () => ({
  markRenewalPaid: mockMarkRenewalPaid,
  getRenewalById: mockGetRenewalById,
  getRenewalByStripeRef: mockGetRenewalByStripeRef,
  appendRenewal: mockAppendRenewal,
  getRenewalsSheetUrl: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../lib/xero-sync", () => ({
  enqueueAndPush: mockEnqueueAndPush,
  isXeroEnabled: mockIsXeroEnabled,
}));

vi.mock("../../lib/stripe-payment-facts", () => ({
  getPaymentFacts: mockGetPaymentFacts,
}));

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  isInitialized: vi.fn().mockReturnValue(false),
  captureException: vi.fn(),
}));

const mockSubscriptionsCreate = vi.fn().mockResolvedValue({ id: "sub_test_123" });
const mockSubscriptionsRetrieve = vi.fn().mockResolvedValue({
  id: "sub_123",
  metadata: { flow: "option_c", plan: "advanced" },
});

vi.mock("stripe", () => {
  const mockPaymentIntentsRetrieve = vi.fn().mockResolvedValue({
    payment_method: "pm_test_123",
  });
  const mockCustomersUpdate = vi.fn().mockResolvedValue({});
  const mockPaymentMethodsAttach = vi.fn().mockResolvedValue({});
  const mockWebhooksConstructEvent = vi.fn().mockImplementation((body, signature, secret) => {
    // Reject invalid signatures (anything not starting with "t=")
    if (!signature.startsWith("t=")) {
      throw new Error("Invalid signature");
    }
    // Parse the body and return a valid event structure
    const parsed = JSON.parse(body);
    return { ...parsed, api_version: "2024-04-10" };
  });

  function MockStripe(this: unknown) {
    return {
      webhooks: { constructEvent: mockWebhooksConstructEvent },
      subscriptions: { create: mockSubscriptionsCreate, retrieve: mockSubscriptionsRetrieve },
      paymentIntents: { retrieve: mockPaymentIntentsRetrieve },
      customers: { update: mockCustomersUpdate },
      paymentMethods: { attach: mockPaymentMethodsAttach },
    };
  }

  return {
    default: MockStripe,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = "whsec_test_secret_12345";

function buildSignature(payload: string): string {
  const crypto = require("crypto");
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

function makeCheckoutSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_123",
    object: "checkout.session",
    metadata: {
      flow: "option_c",
      plan: "advanced",
      recurring_price_id: "price_123",
      next_july1_epoch: "1751328000",
      first_name: "Jane",
      last_name: "Doe",
      applicant_id: "app_123",
    },
    mode: "payment",
    customer: "cus_123",
    customer_email: "jane@example.com",
    payment_intent: "pi_123",
    amount_total: 5000,
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

function makeInvoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id: "in_123",
    object: "invoice",
    metadata: { flow: "option_c" },
    customer: "cus_123",
    ...overrides,
  } as unknown as Stripe.Invoice;
}

/** A subscription_cycle invoice as Stripe delivers it for an Option C
 *  auto-renewal (stripe v20 shape: subscription under parent.subscription_details). */
function makeCycleInvoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: "in_cycle_1",
    object: "invoice",
    billing_reason: "subscription_cycle",
    amount_paid: 15000,
    currency: "nzd",
    customer: "cus_123",
    customer_email: "jane@example.com",
    customer_name: "Jane van Doe",
    created: 1782864000, // 2026-07-01T00:00:00Z
    lines: { data: [{ period: { start: 1782864000, end: 1814400000 } }] },
    parent: {
      type: "subscription_details",
      subscription_details: {
        subscription: "sub_123",
        metadata: { flow: "option_c", plan: "advanced" },
      },
    },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

function makeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_123",
    object: "subscription",
    metadata: { flow: "option_c" },
    customer: "cus_123",
    status: "active",
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function makeReq(body: string, signature: string) {
  return {
    request: {
      headers: new Map([["stripe-signature", signature]]),
      text: vi.fn().mockResolvedValue(body),
    },
  } as unknown as Parameters<(typeof import("../../pages/api/stripe-webhook").POST)>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stripe-webhook", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    // Default: routing resolves to the env-var fallback (matches pre-sheet behavior).
    mockGetRecipientsForEvent.mockImplementation(
      (_event: string, fallback?: string) =>
        Promise.resolve(fallback ? [fallback] : []),
    );
    // Xero defaults: OFF, matching an unconfigured fork. The Xero suite
    // below turns it on explicitly.
    mockIsXeroEnabled.mockReturnValue(false);
    mockEnqueueAndPush.mockResolvedValue(undefined);
    mockGetPaymentFacts.mockResolvedValue({
      paidAt: "2026-07-15T02:00:00.000Z",
      feeCents: 378,
      netCents: 11622,
      fallback: false,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("POST handler - early returns", () => {
    it("returns 400 when stripe-signature header is missing", async () => {
      const { POST } = await import("../../pages/api/stripe-webhook");
      const req = {
        request: {
          headers: new Map(),
          text: vi.fn().mockResolvedValue("{}"),
        },
      } as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when STRIPE_WEBHOOK_SECRET is not configured", async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      const { POST } = await import("../../pages/api/stripe-webhook");
      const req = makeReq("{}", "sig");
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON payload", async () => {
      const { POST } = await import("../../pages/api/stripe-webhook");
      const req = makeReq("not json", buildSignature("not json"));
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid webhook signature", async () => {
      const { POST } = await import("../../pages/api/stripe-webhook");
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: {} } });
      const req = makeReq(body, "bad_sig");
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe("POST handler - checkout.session.completed", () => {
    it("ignores sessions with flow != option_c", async () => {
      const { POST } = await import("../../pages/api/stripe-webhook");
      const session = makeCheckoutSession();
      session.metadata = { flow: "other" };
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
    });

    it("ignores sessions with mode != payment", async () => {
      const { POST } = await import("../../pages/api/stripe-webhook");
      const session = makeCheckoutSession();
      session.mode = "subscription";
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
    });

    it("ignores sessions missing customer", async () => {
      const { POST } = await import("../../pages/api/stripe-webhook");
      const session = makeCheckoutSession({ customer: undefined });
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
    });

    it("ignores sessions missing recurring_price_id", async () => {
      const { POST } = await import("../../pages/api/stripe-webhook");
      const session = makeCheckoutSession();
      session.metadata = { ...session.metadata, recurring_price_id: "" };
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
    });

    it("marks advanced applicant paid and sends confirmation email", async () => {
      mockGetMembership.mockReturnValue(null);
      mockSetActive.mockReturnValue(undefined);
      mockSetAwaitingSubscription.mockReturnValue(undefined);
      mockMarkApplicantPaid.mockResolvedValue(undefined);
      mockGetApplicantById.mockResolvedValue({ email: "jane@example.com", firstName: "Jane", lastName: "Doe" });
      mockSendAdvancedConfirmation.mockResolvedValue(undefined);
      mockCreateAdvancedApplicationReviewDoc.mockResolvedValue("https://docs.google.com/document/d/abc");
      mockSendAdvancedApplicationNotification.mockResolvedValue(undefined);
      mockAppendCheckoutLog.mockResolvedValue(undefined);

      const { POST } = await import("../../pages/api/stripe-webhook");
      const session = makeCheckoutSession({
        metadata: {
          flow: "option_c",
          plan: "advanced",
          recurring_price_id: "price_123",
          next_july1_epoch: "1751328000",
          first_name: "Jane",
          last_name: "Doe",
          applicant_id: "app_123",
        },
      });
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockMarkApplicantPaid).toHaveBeenCalledWith("app_123", "cs_test_123");
      expect(mockSendAdvancedConfirmation).toHaveBeenCalledWith("jane@example.com", "Jane", "app_123");
    });

    it("sends basic confirmation email after basic checkout completes", async () => {
      mockGetMembership.mockReturnValue(null);
      mockSetActive.mockReturnValue(undefined);
      mockSetAwaitingSubscription.mockReturnValue(undefined);
      mockAppendCheckoutLog.mockResolvedValue(undefined);
      mockCreateBasicApplicationReviewDoc.mockResolvedValue("https://docs.google.com/document/d/assoc123");
      mockSendBasicConfirmation.mockResolvedValue(undefined);
      mockSendBasicApplicationNotification.mockResolvedValue(undefined);

      const { POST } = await import("../../pages/api/stripe-webhook");
      const session = makeCheckoutSession({
        metadata: {
          flow: "option_c",
          plan: "basic",
          recurring_price_id: "price_assoc",
          next_july1_epoch: "1751328000",
          first_name: "Bob",
          last_name: "Smith",
          basic_application_id: "assoc_app_456",
          list_on_page: "yes",
        },
      });
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockCreateBasicApplicationReviewDoc).toHaveBeenCalled();
      expect(mockSendBasicConfirmation).toHaveBeenCalledWith(
        "jane@example.com",
        "Bob Smith",
        true,
        "assoc_app_456"
      );
      expect(mockSendBasicApplicationNotification).toHaveBeenCalledWith(
        "admin@example.com",
        "Bob Smith",
        "https://docs.google.com/document/d/assoc123",
        "assoc_app_456"
      );
    });
  });

  describe("POST handler - invoice.payment_failed", () => {
    it("calls setPaymentFailed", async () => {
      mockSetPaymentFailed.mockReturnValue(undefined);
      const { POST } = await import("../../pages/api/stripe-webhook");
      const invoice = makeInvoice();
      const body = JSON.stringify({ type: "invoice.payment_failed", data: { object: invoice } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockSetPaymentFailed).toHaveBeenCalledWith("cus_123", "in_123");
    });
  });

  describe("POST handler - customer.subscription.updated", () => {
    it("calls setCancelled when subscription is canceled", async () => {
      mockSetCancelled.mockReturnValue(undefined);
      const { POST } = await import("../../pages/api/stripe-webhook");
      const sub = makeSubscription({ status: "canceled" });
      const body = JSON.stringify({ type: "customer.subscription.updated", data: { object: sub } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockSetCancelled).toHaveBeenCalledWith("cus_123", "sub_123");
    });

    it("calls setCancelled when subscription is unpaid", async () => {
      mockSetCancelled.mockReturnValue(undefined);
      const { POST } = await import("../../pages/api/stripe-webhook");
      const sub = makeSubscription({ status: "unpaid" });
      const body = JSON.stringify({ type: "customer.subscription.updated", data: { object: sub } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockSetCancelled).toHaveBeenCalledWith("cus_123", "sub_123");
    });

    it("does not call setCancelled for active subscription", async () => {
      mockSetCancelled.mockReturnValue(undefined);
      const { POST } = await import("../../pages/api/stripe-webhook");
      const sub = makeSubscription({ status: "active" });
      const body = JSON.stringify({ type: "customer.subscription.updated", data: { object: sub } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockSetCancelled).not.toHaveBeenCalled();
    });
  });

  describe("POST handler - customer.subscription.deleted", () => {
    it("calls setCancelled", async () => {
      mockSetCancelled.mockReturnValue(undefined);
      const { POST } = await import("../../pages/api/stripe-webhook");
      const sub = makeSubscription();
      const body = JSON.stringify({ type: "customer.subscription.deleted", data: { object: sub } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockSetCancelled).toHaveBeenCalledWith("cus_123", "sub_123");
    });
  });

  describe("wiped-mirror resilience (bug-scan #6)", () => {
    it("proceeds with subscription creation when the mirror row is missing, keeping the Stripe idempotency key", async () => {
      // Simulates the post-wipe state: Stripe replays checkout.session.completed
      // but the mirror has no record. Creation must proceed AND stay safe via
      // the Stripe-side idempotency key (the mirror is only a fast-path guard).
      mockGetMembership.mockResolvedValue(null);
      mockSetAwaitingSubscription.mockResolvedValue(undefined);
      mockSetActive.mockResolvedValue(undefined);
      mockMarkApplicantPaid.mockResolvedValue(undefined);
      mockGetApplicantById.mockResolvedValue(null);
      mockAppendCheckoutLog.mockResolvedValue(undefined);

      const { POST } = await import("../../pages/api/stripe-webhook");
      const session = makeCheckoutSession();
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer: "cus_123" }),
        expect.objectContaining({ idempotencyKey: "option_c_sub_cs_test_123" }),
      );
      // The durable mirror is (re)populated with provenance.
      expect(mockSetAwaitingSubscription).toHaveBeenCalledWith(
        "cus_123",
        expect.objectContaining({ subscriptionId: "sub_test_123" }),
        "cs_test_123",
      );
      expect(mockSetActive).toHaveBeenCalledWith("cus_123", "sub_test_123", "cs_test_123");
    });
  });

  describe("POST handler - invoice.payment_succeeded (auto-renewal, REQ-MR-009/010)", () => {
    beforeEach(() => {
      mockGetRenewalByStripeRef.mockResolvedValue(null);
      mockAppendRenewal.mockResolvedValue(undefined);
      mockSetActive.mockResolvedValue(undefined);
      mockSendRenewalAdminNotification.mockResolvedValue(undefined);
      mockSendRenewalPdLogLink.mockResolvedValue(undefined);
    });

    async function post(invoice: Stripe.Invoice) {
      const { POST } = await import("../../pages/api/stripe-webhook");
      const body = JSON.stringify({ type: "invoice.payment_succeeded", data: { object: invoice } });
      const req = makeReq(body, buildSignature(body));
      return POST(req);
    }

    it("skips billing_reason=subscription_create (the $0 trial-creation invoice)", async () => {
      const res = await post(makeCycleInvoice({ billing_reason: "subscription_create", amount_paid: 0 }));
      expect(res.status).toBe(200);
      expect(mockAppendRenewal).not.toHaveBeenCalled();
    });

    it("skips zero-amount invoices even on subscription_cycle", async () => {
      const res = await post(makeCycleInvoice({ amount_paid: 0 }));
      expect(res.status).toBe(200);
      expect(mockAppendRenewal).not.toHaveBeenCalled();
    });

    it("skips non-option_c subscriptions", async () => {
      const invoice = makeCycleInvoice();
      (invoice as unknown as { parent: { subscription_details: { metadata: Record<string, string> } } })
        .parent.subscription_details.metadata = { flow: "something_else" };
      const res = await post(invoice);
      expect(res.status).toBe(200);
      expect(mockAppendRenewal).not.toHaveBeenCalled();
    });

    it("falls back to subscriptions.retrieve when the invoice snapshot has no flow metadata", async () => {
      const invoice = makeCycleInvoice();
      (invoice as unknown as { parent: { subscription_details: { metadata: null } } })
        .parent.subscription_details.metadata = null;
      mockSubscriptionsRetrieve.mockResolvedValueOnce({
        id: "sub_123",
        metadata: { flow: "option_c", plan: "advanced" },
      });
      const res = await post(invoice);
      expect(res.status).toBe(200);
      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith("sub_123");
      expect(mockAppendRenewal).toHaveBeenCalled();
    });

    it("records an advanced auto-renewal: paid row + admin notification + PD-log link + setActive", async () => {
      const res = await post(makeCycleInvoice());
      expect(res.status).toBe(200);

      expect(mockAppendRenewal).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: "adv",
          year: 2026,
          firstName: "Jane van",
          lastName: "Doe",
          email: "jane@example.com",
          amountCents: 15000,
          currency: "nzd",
          stripeSession: "in_cycle_1",
          paymentStatus: "paid",
          paidAt: expect.any(String),
        }),
      );
      const renewalId = mockAppendRenewal.mock.calls[0][0].renewalId as string;
      expect(mockSendRenewalAdminNotification).toHaveBeenCalledWith(
        "admin@example.com",
        "adv",
        "Jane van Doe",
        "jane@example.com",
        renewalId,
        15000,
        undefined,
      );
      expect(mockSendRenewalPdLogLink).toHaveBeenCalledWith(
        "jane@example.com",
        "Jane van Doe",
        expect.stringContaining(`/renew/pd-log?token=${renewalId}`),
        renewalId,
      );
      // Durable mirror self-heal with the invoice as provenance.
      expect(mockSetActive).toHaveBeenCalledWith("cus_123", "sub_123", "in_cycle_1");
    });

    it("records a basic auto-renewal without a PD-log link", async () => {
      const invoice = makeCycleInvoice({ customer_name: "Bob" });
      (invoice as unknown as { parent: { subscription_details: { metadata: Record<string, string> } } })
        .parent.subscription_details.metadata = { flow: "option_c", plan: "basic" };
      const res = await post(invoice);
      expect(res.status).toBe(200);
      expect(mockAppendRenewal).toHaveBeenCalledWith(
        expect.objectContaining({ tier: "basic", firstName: "Bob", lastName: "" }),
      );
      expect(mockSendRenewalPdLogLink).not.toHaveBeenCalled();
    });

    it("is idempotent: an already-recorded invoice appends nothing and fires no side effects", async () => {
      mockGetRenewalByStripeRef.mockResolvedValueOnce({ renewalId: "r_prev" });
      const res = await post(makeCycleInvoice());
      expect(res.status).toBe(200);
      expect(mockGetRenewalByStripeRef).toHaveBeenCalledWith("in_cycle_1");
      expect(mockAppendRenewal).not.toHaveBeenCalled();
      expect(mockSendRenewalAdminNotification).not.toHaveBeenCalled();
      expect(mockSetActive).not.toHaveBeenCalled();
    });

    it("returns 500 when the Renewals append fails (Stripe retry contract)", async () => {
      mockAppendRenewal.mockRejectedValueOnce(new Error("sheets down"));
      const res = await post(makeCycleInvoice());
      expect(res.status).toBe(500);
      expect(mockSendRenewalAdminNotification).not.toHaveBeenCalled();
    });
  });

  describe("renewal flow", () => {
    beforeEach(() => {
      mockMarkRenewalPaid.mockReset();
      mockGetRenewalById.mockReset();
      mockAppendCheckoutLog.mockReset();
      mockSendRenewalPdLogLink.mockReset();
      mockSendRenewalPdLogLink.mockResolvedValue(undefined);
      mockSendRenewalAdminNotification.mockReset();
      mockSendRenewalAdminNotification.mockResolvedValue(undefined);
    });

    it("marks renewal row paid when checkout.session.completed fires for renewal metadata", async () => {
      const session = makeCheckoutSession({
        id: "cs_renewal_1",
        customer: "cus_renewal",
        customer_email: "alice@example.com",
        payment_intent: "pi_1",
        metadata: {
          flow: "renewal",
          tier: "adv",
          renewal_id: "r1",
          renewal_year: "2026",
          first_name: "Alice",
          last_name: "Smith",
          email: "alice@example.com",
          phone: "",
          pd_entries: "[]",
          amount_cents: "15000",
        },
      });

      mockGetRenewalById.mockResolvedValueOnce({
        renewalId: "r1",
        tier: "adv",
        renewalYear: 2026,
        firstName: "Alice",
        lastName: "Smith",
        email: "alice@example.com",
        phone: "",
        pdEntries: [],
        amountPaidCents: 15000,
        currency: "nzd",
        paymentStatus: "pending",
        stripeSession: "cs_renewal_1",
        createdAt: "2026-06-23T10:00:00Z",
        paidAt: "",
      });
      mockMarkRenewalPaid.mockResolvedValueOnce(undefined);
      mockAppendCheckoutLog.mockResolvedValueOnce(undefined);

      const { POST } = await import("../../pages/api/stripe-webhook");
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const req = makeReq(body, buildSignature(body));
      const response = await POST(req);
      expect(response.status).toBe(200);

      expect(mockMarkRenewalPaid).toHaveBeenCalledWith("r1", "cs_renewal_1", expect.any(String));
      expect(mockGetRenewalById).toHaveBeenCalledWith("r1");
      expect(mockAppendCheckoutLog).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: "Alice",
          lastName: "Smith",
          email: "alice@example.com",
          plan: "renewal_adv",
          amountPaid: 15000,
          sessionId: "cs_renewal_1",
          customerId: "cus_renewal",
        })
      );
      expect(mockSendRenewalAdminNotification).toHaveBeenCalledWith(
        "admin@example.com",
        "adv",
        "Alice Smith",
        "alice@example.com",
        "r1",
        15000,
        undefined,
      );
      expect(mockSendRenewalPdLogLink).toHaveBeenCalledWith(
        "alice@example.com",
        "Alice Smith",
        expect.stringContaining("/renew/pd-log?token=r1"),
        "r1",
      );
    });

    it("is idempotent — skips markRenewalPaid when row already paid", async () => {
      const session = makeCheckoutSession({
        id: "cs_renewal_2",
        customer: "cus_2",
        customer_email: "bob@example.com",
        payment_intent: "pi_2",
        metadata: {
          flow: "renewal",
          tier: "basic",
          renewal_id: "r2",
          renewal_year: "2026",
          first_name: "Bob",
          last_name: "Doe",
          email: "bob@example.com",
          phone: "",
          pd_entries: "",
          amount_cents: "7500",
        },
      });

      mockGetRenewalById.mockResolvedValueOnce({
        renewalId: "r2",
        tier: "basic",
        renewalYear: 2026,
        firstName: "Bob",
        lastName: "Doe",
        email: "bob@example.com",
        phone: "",
        pdEntries: [],
        amountPaidCents: 7500,
        currency: "nzd",
        paymentStatus: "paid",
        stripeSession: "cs_renewal_2",
        createdAt: "2026-06-23T10:00:00Z",
        paidAt: "2026-06-23T10:01:00Z",
      });

      const { POST } = await import("../../pages/api/stripe-webhook");
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const req = makeReq(body, buildSignature(body));
      const response = await POST(req);
      expect(response.status).toBe(200);
      expect(mockMarkRenewalPaid).not.toHaveBeenCalled();
      expect(mockAppendCheckoutLog).not.toHaveBeenCalled();
    });

    it("does nothing when renewal row not found (logs and returns 200)", async () => {
      const session = makeCheckoutSession({
        id: "cs_orphan",
        customer: "cus_3",
        customer_email: "x@example.com",
        payment_intent: "pi_3",
        metadata: {
          flow: "renewal",
          tier: "adv",
          renewal_id: "missing",
        },
      });

      mockGetRenewalById.mockResolvedValueOnce(null);

      const { POST } = await import("../../pages/api/stripe-webhook");
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const req = makeReq(body, buildSignature(body));
      const response = await POST(req);
      expect(response.status).toBe(200);
      expect(mockMarkRenewalPaid).not.toHaveBeenCalled();
      expect(mockAppendCheckoutLog).not.toHaveBeenCalled();
    });

    it("routes renewal admin notification to sheet-driven recipients (overrides env fallback)", async () => {
      // Sheet has two enabled rows for advanced_renewal_received → both notified,
      // the env-var fallback is NOT used.
      mockGetRecipientsForEvent.mockImplementation((event: string) =>
        Promise.resolve(
          event === "advanced_renewal_received"
            ? ["committee@club.org", "treasurer@club.org"]
            : [],
        ),
      );

      const session = makeCheckoutSession({
        id: "cs_renewal_routed",
        customer: "cus_routed",
        customer_email: "alice@example.com",
        payment_intent: "pi_routed",
        metadata: {
          flow: "renewal",
          tier: "adv",
          renewal_id: "r9",
          renewal_year: "2026",
          first_name: "Alice",
          last_name: "Smith",
          email: "alice@example.com",
          phone: "",
          pd_entries: "[]",
          amount_cents: "15000",
        },
      });

      mockGetRenewalById.mockResolvedValueOnce({
        renewalId: "r9",
        tier: "adv",
        renewalYear: 2026,
        firstName: "Alice",
        lastName: "Smith",
        email: "alice@example.com",
        phone: "",
        pdEntries: [],
        amountPaidCents: 15000,
        currency: "nzd",
        paymentStatus: "pending",
        stripeSession: "cs_renewal_routed",
        createdAt: "2026-06-23T10:00:00Z",
        paidAt: "",
      });
      mockMarkRenewalPaid.mockResolvedValueOnce(undefined);
      mockAppendCheckoutLog.mockResolvedValueOnce(undefined);

      const { POST } = await import("../../pages/api/stripe-webhook");
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const req = makeReq(body, buildSignature(body));
      const response = await POST(req);
      expect(response.status).toBe(200);

      expect(mockGetRecipientsForEvent).toHaveBeenCalledWith(
        "advanced_renewal_received",
        "admin@example.com",
      );
      expect(mockSendRenewalAdminNotification).toHaveBeenCalledTimes(2);
      expect(mockSendRenewalAdminNotification).toHaveBeenCalledWith(
        "committee@club.org",
        "adv",
        "Alice Smith",
        "alice@example.com",
        "r9",
        15000,
        undefined,
      );
      expect(mockSendRenewalAdminNotification).toHaveBeenCalledWith(
        "treasurer@club.org",
        "adv",
        "Alice Smith",
        "alice@example.com",
        "r9",
        15000,
        undefined,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Xero sync wiring (spec 016)
  // -------------------------------------------------------------------------
  describe("Xero sync", () => {
    beforeEach(() => {
      mockIsXeroEnabled.mockReturnValue(true);

      // vi.clearAllMocks() clears recorded calls but NOT queued
      // mockResolvedValueOnce implementations, so leftover "once" values from
      // earlier tests leak in and get consumed here. Reset the ones these
      // tests drive before re-establishing them.
      for (const m of [
        mockGetMembership,
        mockGetRenewalById,
        mockGetRenewalByStripeRef,
        mockGetApplicantById,
        mockMarkApplicantPaid,
        mockMarkRenewalPaid,
        mockAppendRenewal,
      ]) {
        m.mockReset();
      }

      // These are all called as `fn(...).catch(...)` / `.then(...)` in the
      // handler, so a bare vi.fn() returning undefined throws a TypeError and
      // 500s the webhook before Xero is ever reached.
      mockSendAdvancedConfirmation.mockResolvedValue(undefined);
      mockSendBasicConfirmation.mockResolvedValue(undefined);
      mockSendRenewalPdLogLink.mockResolvedValue(undefined);
      mockSendRenewalAdminNotification.mockResolvedValue(undefined);
      mockCreateAdvancedApplicationReviewDoc.mockResolvedValue("https://doc");
      mockCreateBasicApplicationReviewDoc.mockResolvedValue("https://doc");
      mockAppendCheckoutLog.mockResolvedValue(undefined);
      mockSetActive.mockResolvedValue(undefined);
    });

    async function post(body: string) {
      const { POST } = await import("../../pages/api/stripe-webhook");
      return POST(makeReq(body, buildSignature(body)));
    }

    function checkoutEvent(session: unknown, livemode = true) {
      return JSON.stringify({
        type: "checkout.session.completed",
        livemode,
        data: { object: session },
      });
    }

    it("enqueues an advanced_new record for an advanced application", async () => {
      mockGetMembership.mockResolvedValue({ subscriptionId: "sub_existing" });
      mockGetApplicantById.mockResolvedValue({
        email: "Jane@Example.COM ",
        firstName: "Jane",
        lastName: "Doe",
      });
      mockMarkApplicantPaid.mockResolvedValue(undefined);

      const res = await post(checkoutEvent(makeCheckoutSession({ currency: "usd" })));

      expect(res.status).toBe(200);
      expect(mockEnqueueAndPush).toHaveBeenCalledTimes(1);
      expect(mockEnqueueAndPush).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeId: "cs_test_123",
          flow: "advanced_new",
          internalId: "app_123",
          // Normalised: ContactNumber is keyed on this.
          email: "jane@example.com",
          contactName: "Jane Doe",
          amountCents: 5000,
          currency: "usd",
          livemode: true,
          paidAt: "2026-07-15T02:00:00.000Z",
          feeCents: 378,
        }),
      );
    });

    it("still enqueues when the applicant row could not be read", async () => {
      // A missing sheet row must not also cost the Xero invoice.
      mockGetMembership.mockResolvedValue({ subscriptionId: "sub_existing" });
      mockGetApplicantById.mockResolvedValue(null);
      mockMarkApplicantPaid.mockResolvedValue(undefined);

      await post(checkoutEvent(makeCheckoutSession()));

      expect(mockEnqueueAndPush).toHaveBeenCalledWith(
        expect.objectContaining({
          flow: "advanced_new",
          email: "jane@example.com",
          contactName: "Jane Doe",
        }),
      );
    });

    it("enqueues a basic_new record for a basic application", async () => {
      mockGetMembership.mockResolvedValue({ subscriptionId: "sub_existing" });
      const session = makeCheckoutSession({
        id: "cs_basic_1",
        customer_email: "assoc@example.com",
        amount_total: 3000,
        metadata: {
          flow: "option_c",
          plan: "basic",
          recurring_price_id: "price_123",
          next_july1_epoch: "1751328000",
          first_name: "Bob",
          last_name: "Roe",
          basic_application_id: "assoc_9",
        },
      } as Partial<Stripe.Checkout.Session>);

      await post(checkoutEvent(session));

      expect(mockEnqueueAndPush).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeId: "cs_basic_1",
          flow: "basic_new",
          internalId: "assoc_9",
          email: "assoc@example.com",
          contactName: "Bob Roe",
          amountCents: 3000,
        }),
      );
    });

    it("enqueues a direct membership purchase that carries no application id", async () => {
      // /index.astro posts a bare {plan} — neither applicant_id nor
      // basic_application_id is set. Gating Xero on those ids would take the
      // money and never write a row.
      mockGetMembership.mockResolvedValue({ subscriptionId: "sub_existing" });
      const session = makeCheckoutSession({
        id: "cs_direct_1",
        customer_email: "direct@example.com",
        amount_total: 7500,
        metadata: {
          flow: "option_c",
          plan: "basic",
          recurring_price_id: "price_123",
          next_july1_epoch: "1751328000",
          first_name: "Cara",
          last_name: "Loe",
        },
      } as Partial<Stripe.Checkout.Session>);

      await post(checkoutEvent(session));

      expect(mockEnqueueAndPush).toHaveBeenCalledTimes(1);
      expect(mockEnqueueAndPush).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeId: "cs_direct_1",
          flow: "basic_new",
          // Falls back to the session id so the invoice still joins to Stripe.
          internalId: "cs_direct_1",
          email: "direct@example.com",
          contactName: "Cara Loe",
          amountCents: 7500,
        }),
      );
    });

    it("enqueues once, not twice, for an advanced application", async () => {
      mockGetMembership.mockResolvedValue({ subscriptionId: "sub_existing" });
      mockGetApplicantById.mockResolvedValue({
        email: "jane@example.com",
        firstName: "Jane",
        lastName: "Doe",
      });
      mockMarkApplicantPaid.mockResolvedValue(undefined);

      await post(checkoutEvent(makeCheckoutSession()));

      expect(mockEnqueueAndPush).toHaveBeenCalledTimes(1);
    });

    it("enqueues a renewal record for a manual renewal", async () => {
      const session = makeCheckoutSession({
        id: "cs_renewal_x",
        customer_email: "alice@example.com",
        metadata: { flow: "renewal", renewal_id: "r1" },
      } as Partial<Stripe.Checkout.Session>);
      mockGetRenewalById.mockResolvedValue({
        renewalId: "r1",
        tier: "adv",
        firstName: "Alice",
        lastName: "Smith",
        email: "alice@example.com",
        amountPaidCents: 15000,
        paymentStatus: "pending",
      });
      mockMarkRenewalPaid.mockResolvedValue(undefined);

      await post(checkoutEvent(session));

      expect(mockEnqueueAndPush).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeId: "cs_renewal_x",
          flow: "renewal",
          internalId: "r1",
          email: "alice@example.com",
          contactName: "Alice Smith",
          amountCents: 15000,
        }),
      );
    });

    it("enqueues an auto_renewal record for a subscription-cycle invoice", async () => {
      mockGetRenewalByStripeRef.mockResolvedValue(null);
      mockAppendRenewal.mockResolvedValue(undefined);

      const body = JSON.stringify({
        type: "invoice.payment_succeeded",
        livemode: true,
        data: { object: makeCycleInvoice() },
      });
      const res = await post(body);

      expect(res.status).toBe(200);
      expect(mockEnqueueAndPush).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeId: "in_cycle_1",
          flow: "auto_renewal",
          email: "jane@example.com",
          contactName: "Jane van Doe",
          amountCents: 15000,
          livemode: true,
        }),
      );
    });

    it("propagates test-mode livemode so the environment guard can reject it", async () => {
      mockGetMembership.mockResolvedValue({ subscriptionId: "sub_existing" });
      mockGetApplicantById.mockResolvedValue(null);
      mockMarkApplicantPaid.mockResolvedValue(undefined);

      await post(checkoutEvent(makeCheckoutSession(), false));

      expect(mockEnqueueAndPush).toHaveBeenCalledWith(
        expect.objectContaining({ livemode: false }),
      );
    });

    it("returns 200 when the Xero push throws", async () => {
      mockGetMembership.mockResolvedValue({ subscriptionId: "sub_existing" });
      mockGetApplicantById.mockResolvedValue(null);
      mockMarkApplicantPaid.mockResolvedValue(undefined);
      mockEnqueueAndPush.mockRejectedValue(new Error("Xero exploded"));

      const res = await post(checkoutEvent(makeCheckoutSession()));

      expect(res.status).toBe(200);
    });

    it("skips Stripe fee lookup entirely when XERO_ENABLED is unset", async () => {
      mockIsXeroEnabled.mockReturnValue(false);
      mockGetMembership.mockResolvedValue({ subscriptionId: "sub_existing" });
      mockGetApplicantById.mockResolvedValue(null);
      mockMarkApplicantPaid.mockResolvedValue(undefined);

      await post(checkoutEvent(makeCheckoutSession()));

      expect(mockGetPaymentFacts).not.toHaveBeenCalled();
      expect(mockEnqueueAndPush).not.toHaveBeenCalled();
    });
  });
});