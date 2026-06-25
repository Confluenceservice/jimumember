import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

const mockSendProfessionalConfirmation = vi.fn();
const mockSendProfessionalApplicationNotification = vi.fn();
const mockSendAssociateConfirmation = vi.fn();
const mockSendAssociateApplicationNotification = vi.fn();
const mockSendRenewalPdLogLink = vi.fn();
const mockSendRenewalAdminNotification = vi.fn();
const mockAppendCheckoutLog = vi.fn();
const mockCreateApplicationReviewDoc = vi.fn();
const mockCreateAssociateApplicationReviewDoc = vi.fn();
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

vi.mock("../../lib/email-sender", () => ({
  sendProfessionalConfirmation: mockSendProfessionalConfirmation,
  sendProfessionalApplicationNotification: mockSendProfessionalApplicationNotification,
  sendAssociateConfirmation: mockSendAssociateConfirmation,
  sendAssociateApplicationNotification: mockSendAssociateApplicationNotification,
  sendRenewalPdLogLink: mockSendRenewalPdLogLink,
  sendRenewalAdminNotification: mockSendRenewalAdminNotification,
}));

vi.mock("../../lib/google-sheets", () => ({
  appendCheckoutLog: mockAppendCheckoutLog,
}));

vi.mock("../../lib/google-docs", () => ({
  createApplicationReviewDoc: mockCreateApplicationReviewDoc,
  createAssociateApplicationReviewDoc: mockCreateAssociateApplicationReviewDoc,
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
  getRenewalsSheetUrl: vi.fn().mockReturnValue(undefined),
}));

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  isInitialized: vi.fn().mockReturnValue(false),
  captureException: vi.fn(),
}));

vi.mock("stripe", () => {
  const mockSubscriptionsCreate = vi.fn().mockResolvedValue({ id: "sub_test_123" });
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
      subscriptions: { create: mockSubscriptionsCreate },
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
      plan: "professional",
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

    it("marks professional applicant paid and sends confirmation email", async () => {
      mockGetMembership.mockReturnValue(null);
      mockSetActive.mockReturnValue(undefined);
      mockSetAwaitingSubscription.mockReturnValue(undefined);
      mockMarkApplicantPaid.mockResolvedValue(undefined);
      mockGetApplicantById.mockResolvedValue({ email: "jane@example.com", firstName: "Jane", lastName: "Doe" });
      mockSendProfessionalConfirmation.mockResolvedValue(undefined);
      mockCreateApplicationReviewDoc.mockResolvedValue("https://docs.google.com/document/d/abc");
      mockSendProfessionalApplicationNotification.mockResolvedValue(undefined);
      mockAppendCheckoutLog.mockResolvedValue(undefined);

      const { POST } = await import("../../pages/api/stripe-webhook");
      const session = makeCheckoutSession({
        metadata: {
          flow: "option_c",
          plan: "professional",
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
      expect(mockSendProfessionalConfirmation).toHaveBeenCalledWith("jane@example.com", "Jane", "app_123");
    });

    it("sends associate confirmation email after associate checkout completes", async () => {
      mockGetMembership.mockReturnValue(null);
      mockSetActive.mockReturnValue(undefined);
      mockSetAwaitingSubscription.mockReturnValue(undefined);
      mockAppendCheckoutLog.mockResolvedValue(undefined);
      mockCreateAssociateApplicationReviewDoc.mockResolvedValue("https://docs.google.com/document/d/assoc123");
      mockSendAssociateConfirmation.mockResolvedValue(undefined);
      mockSendAssociateApplicationNotification.mockResolvedValue(undefined);

      const { POST } = await import("../../pages/api/stripe-webhook");
      const session = makeCheckoutSession({
        metadata: {
          flow: "option_c",
          plan: "associate",
          recurring_price_id: "price_assoc",
          next_july1_epoch: "1751328000",
          first_name: "Bob",
          last_name: "Smith",
          associate_application_id: "assoc_app_456",
          list_on_page: "yes",
        },
      });
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockCreateAssociateApplicationReviewDoc).toHaveBeenCalled();
      expect(mockSendAssociateConfirmation).toHaveBeenCalledWith(
        "jane@example.com",
        "Bob Smith",
        true,
        "assoc_app_456"
      );
      expect(mockSendAssociateApplicationNotification).toHaveBeenCalledWith(
        "admin@eldaa.org.nz",
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
      expect(mockSetPaymentFailed).toHaveBeenCalledWith("cus_123");
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
      expect(mockSetCancelled).toHaveBeenCalledWith("cus_123");
    });

    it("calls setCancelled when subscription is unpaid", async () => {
      mockSetCancelled.mockReturnValue(undefined);
      const { POST } = await import("../../pages/api/stripe-webhook");
      const sub = makeSubscription({ status: "unpaid" });
      const body = JSON.stringify({ type: "customer.subscription.updated", data: { object: sub } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockSetCancelled).toHaveBeenCalledWith("cus_123");
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
      expect(mockSetCancelled).toHaveBeenCalledWith("cus_123");
    });
  });

  describe("POST handler - invoice.paid", () => {
    it("skips renewal if subscription already active", async () => {
      mockHasActiveSubscription.mockReturnValue(true);
      const { POST } = await import("../../pages/api/stripe-webhook");
      const invoice = makeInvoice();
      const body = JSON.stringify({ type: "invoice.paid", data: { object: invoice } });
      const req = makeReq(body, buildSignature(body));
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockHasActiveSubscription).toHaveBeenCalledWith("cus_123");
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
          tier: "pm",
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
        tier: "pm",
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
          plan: "renewal_pm",
          amountPaid: 15000,
          sessionId: "cs_renewal_1",
          customerId: "cus_renewal",
        })
      );
      expect(mockSendRenewalAdminNotification).toHaveBeenCalledWith(
        "admin@eldaa.org.nz",
        "pm",
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
          tier: "am",
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
        tier: "am",
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
          tier: "pm",
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
  });
});