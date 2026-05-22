import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

const mockSendProfessionalConfirmation = vi.fn();
const mockSendProfessionalApplicationNotification = vi.fn();
const mockSendAssociateConfirmation = vi.fn();
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

vi.mock("../../lib/email-sender", () => ({
  sendProfessionalConfirmation: mockSendProfessionalConfirmation,
  sendProfessionalApplicationNotification: mockSendProfessionalApplicationNotification,
  sendAssociateConfirmation: mockSendAssociateConfirmation,
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
  } as unknown as Parameters<import("../../pages/api/stripe-webhook").POST>[0];
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
      } as unknown as Parameters<POST>[0];
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
      expect(mockSendProfessionalConfirmation).toHaveBeenCalledWith("jane@example.com", "Jane");
    });

    it("sends associate confirmation email after associate checkout completes", async () => {
      mockGetMembership.mockReturnValue(null);
      mockSetActive.mockReturnValue(undefined);
      mockSetAwaitingSubscription.mockReturnValue(undefined);
      mockAppendCheckoutLog.mockResolvedValue(undefined);
      mockCreateAssociateApplicationReviewDoc.mockResolvedValue("https://docs.google.com/document/d/assoc123");
      mockSendAssociateConfirmation.mockResolvedValue(undefined);

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
        true
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
});