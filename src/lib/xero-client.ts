import { getXeroAuth, invalidateAccessToken } from "./xero-auth";
import { logger } from "./logger";

/**
 * Thin typed `fetch` wrapper over the Xero Accounting API.
 *
 * Deliberately NOT `xero-node`: that SDK drags a large dependency tree into
 * a 256 MB Fly machine and its token store assumes a long-lived process,
 * which `min_machines_running = 0` does not give us.
 *
 * The single most important thing this module exports is the TRANSIENT vs
 * PERMANENT distinction on XeroApiError. xero-sync branches on it:
 *   transient -> the Xero Sync row stays `pending` and the sweeper retries
 *   permanent -> the row goes `failed_permanent` and is never swept again
 * Misclassifying a permanent failure as transient produces a row that is
 * retried hourly forever; the reverse silently drops revenue from Xero.
 */

const API_BASE = "https://api.xero.com/api.xro/2.0";
const CONNECTIONS_URL = "https://api.xero.com/connections";

/**
 * A 429 is only worth waiting out INLINE if the wait is short: this client
 * is awaited inside the Stripe webhook, and Stripe times the request out.
 * Longer waits are handed to the sweeper as transient instead.
 */
const MAX_INLINE_RETRY_MS = 5_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;

export class XeroApiError extends Error {
  readonly status: number;
  /** true => do not retry, ever. false => the sweeper should try again. */
  readonly permanent: boolean;

  constructor(message: string, status: number, permanent: boolean) {
    super(message);
    this.name = "XeroApiError";
    this.status = status;
    this.permanent = permanent;
  }
}

export interface XeroContact {
  ContactID: string;
  Name?: string;
  ContactNumber?: string;
  EmailAddress?: string;
}

export interface XeroPaymentRef {
  PaymentID: string;
  Amount?: number;
}

export interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber?: string;
  Status?: string;
  Total?: number;
  /** 0 once fully paid. xero-sync resumes a half-finished push on this. */
  AmountDue?: number;
  Payments?: XeroPaymentRef[];
}

export interface XeroTaxRate {
  Name?: string;
  TaxType?: string;
  EffectiveRate?: number;
}

export interface XeroConnection {
  id?: string;
  tenantId?: string;
  tenantName?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Xero's `where` clauses delimit strings with double quotes and have no
 * escape syntax we can rely on, so a value containing a quote, backslash or
 * newline could break out of the predicate. Every value we pass is derived
 * from a member email, which legitimately contains none of these — so
 * reject rather than mangle, and let the caller see a permanent error.
 */
function assertSafeFilterValue(value: string, field: string): void {
  if (/["\\\r\n]/.test(value)) {
    throw new XeroApiError(
      `XERO_UNSAFE_FILTER: ${field} contains a character that cannot appear in a where clause`,
      400,
      true,
    );
  }
}

/**
 * 429 and 5xx are worth another attempt; everything else in 4xx is a bug in
 * our payload (validation error, unknown account code, bad tenant) that
 * will fail identically on every retry.
 */
function classify(status: number): boolean {
  if (status === 429) return false;
  if (status >= 500) return false;
  return true; // 4xx other than 429
}

function retryAfterMs(res: Response): number {
  const header = res.headers.get("Retry-After");
  if (!header) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_AFTER_MS;
  return seconds * 1000;
}

async function errorFrom(res: Response, url: string): Promise<XeroApiError> {
  // Xero puts validation detail in the body; it is our own payload echoed
  // back, so it is safe to surface and is the only way to debug a 400.
  const body = await res.text().catch(() => "");
  const permanent = classify(res.status);
  return new XeroApiError(
    `XERO_API_${res.status}: ${url} ${body.slice(0, 500)}`,
    res.status,
    permanent,
  );
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Absolute URL override — /connections lives outside the /api.xro/2.0 base. */
  absoluteUrl?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, absoluteUrl } = options;
  const url = absoluteUrl ?? `${API_BASE}${path}`;

  // Attempt 1 -> a 401 invalidates the cached token and re-runs once with a
  // fresh one; a short 429 sleeps and re-runs once. Both cap at ONE retry:
  // this is inside the webhook, and the sweeper is the real retry loop.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { accessToken, tenantId } = await getXeroAuth().getAccessToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (res.ok) return (await res.json()) as T;

    if (attempt === 1 && res.status === 401) {
      // Revoked, or expired earlier than our safety margin predicted.
      logger.warn("xero_client.401_retrying_with_fresh_token", { url });
      invalidateAccessToken();
      continue;
    }

    if (attempt === 1 && res.status === 429) {
      const waitMs = retryAfterMs(res);
      if (waitMs > MAX_INLINE_RETRY_MS) {
        logger.warn("xero_client.429_deferring_to_sweeper", { url, waitMs });
        throw new XeroApiError(
          `XERO_API_429: ${url} rate limited for ${waitMs}ms — deferred`,
          429,
          false,
        );
      }
      logger.warn("xero_client.429_retrying", { url, waitMs });
      await sleep(waitMs);
      continue;
    }

    throw await errorFrom(res, url);
  }

  // Both attempts consumed by retryable failures without a terminal throw.
  throw new XeroApiError(`XERO_API_RETRY_EXHAUSTED: ${url}`, 503, false);
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/** Connection verification: the org's real TaxType codes (runbook step 1). */
export async function getTaxRates(): Promise<XeroTaxRate[]> {
  const data = await request<{ TaxRates?: XeroTaxRate[] }>("/TaxRates");
  return data.TaxRates ?? [];
}

/** Health probe + tenant discovery. Lives outside the /api.xro/2.0 base. */
export async function getConnections(): Promise<XeroConnection[]> {
  return request<XeroConnection[]>("", { absoluteUrl: CONNECTIONS_URL });
}

/**
 * Looks a Contact up by ContactNumber — never by Name. Xero enforces
 * uniqueness behaviour on Name, so two same-name members would collide;
 * ContactNumber is our own deterministic key (the normalised email).
 */
export async function findContactByNumber(
  contactNumber: string,
): Promise<XeroContact | null> {
  assertSafeFilterValue(contactNumber, "ContactNumber");
  const where = encodeURIComponent(`ContactNumber=="${contactNumber}"`);
  const data = await request<{ Contacts?: XeroContact[] }>(`/Contacts?where=${where}`);
  return data.Contacts?.[0] ?? null;
}

/**
 * Looks an Invoice up by our deterministic InvoiceNumber (the Stripe id).
 * The returned AmountDue/Payments are what let xero-sync tell "already fully
 * done" from "invoice created but payment never landed".
 */
export async function findInvoiceByNumber(
  invoiceNumber: string,
): Promise<XeroInvoice | null> {
  assertSafeFilterValue(invoiceNumber, "InvoiceNumber");
  const data = await request<{ Invoices?: XeroInvoice[] }>(
    `/Invoices?InvoiceNumbers=${encodeURIComponent(invoiceNumber)}`,
  );
  return data.Invoices?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Write helpers. Xero wraps every write in a plural envelope and answers
// with the same shape.
// ---------------------------------------------------------------------------

export async function createContact(payload: Record<string, unknown>): Promise<XeroContact> {
  const data = await request<{ Contacts?: XeroContact[] }>("/Contacts", {
    method: "POST",
    body: { Contacts: [payload] },
  });
  const created = data.Contacts?.[0];
  if (!created?.ContactID) {
    throw new XeroApiError("XERO_CONTACT_CREATE_NO_ID: unexpected response shape", 502, false);
  }
  return created;
}

export async function createInvoice(payload: Record<string, unknown>): Promise<XeroInvoice> {
  const data = await request<{ Invoices?: XeroInvoice[] }>("/Invoices", {
    method: "POST",
    body: { Invoices: [payload] },
  });
  const created = data.Invoices?.[0];
  if (!created?.InvoiceID) {
    throw new XeroApiError("XERO_INVOICE_CREATE_NO_ID: unexpected response shape", 502, false);
  }
  return created;
}

export async function createPayment(payload: Record<string, unknown>): Promise<XeroPaymentRef> {
  const data = await request<{ Payments?: XeroPaymentRef[] }>("/Payments", {
    method: "POST",
    body: { Payments: [payload] },
  });
  const created = data.Payments?.[0];
  if (!created?.PaymentID) {
    throw new XeroApiError("XERO_PAYMENT_CREATE_NO_ID: unexpected response shape", 502, false);
  }
  return created;
}
