/**
 * Per-instance localisation constants.
 *
 * The blueprint ships with generic defaults: USD currency, UTC, and a 1 July
 * membership-year anchor (renewals and deferred subscriptions align to the
 * next 1 July). These values were previously hardcoded across the checkout,
 * pricing, sheet-logging and email modules. Centralised here so any instance
 * can change them in one place.
 *
 * See docs/CUSTOMIZE.md → "Localisation constants" before deploying for a
 * different region/currency. Note that Stripe Prices must also be created in
 * the matching currency, or the currency guard in payments/stripe/prices.ts will
 * reject them and /api/health will report "degraded".
 */

/** ISO 4217 currency code, lower-case (Stripe's convention for `currency`). */
export const CURRENCY = "usd";

/** Symbol prefixed to formatted money amounts, e.g. "$". */
export const CURRENCY_SYMBOL = "$";

/** IANA timezone used for the membership-year anchor and proration math. */
export const TIMEZONE = "UTC";

/**
 * Membership-year anchor. Renewals and the deferred subscription's
 * `trial_end` align to the next occurrence of this month/day.
 *
 * Overridable per instance via env vars (server-side only — the anchor is
 * never read in client code, so no PUBLIC_ prefix):
 *   RENEWAL_ANCHOR_MONTH  1–12  (default 7 = July)
 *   RENEWAL_ANCHOR_DAY    1–31  (default 1)
 * Invalid / missing values fall back to the July-1 defaults so existing
 * deployments keep working without setting them.
 */
const DEFAULT_RENEWAL_ANCHOR_MONTH = 7; // July
const DEFAULT_RENEWAL_ANCHOR_DAY = 1;

function readAnchorEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export const RENEWAL_ANCHOR_MONTH = readAnchorEnv(
  "RENEWAL_ANCHOR_MONTH",
  DEFAULT_RENEWAL_ANCHOR_MONTH,
  1,
  12,
);
export const RENEWAL_ANCHOR_DAY = readAnchorEnv(
  "RENEWAL_ANCHOR_DAY",
  DEFAULT_RENEWAL_ANCHOR_DAY,
  1,
  31,
);

/** Format an integer cent amount as a display string, e.g. 7500 → "$75.00". */
export function formatMoney(amountInCents: number): string {
  return `${CURRENCY_SYMBOL}${(amountInCents / 100).toFixed(2)}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Human label for the membership-year anchor in `${day} ${month}` form,
 * e.g. "1 July". Used in checkout copy and on the landing pages so the
 * displayed renewal date follows RENEWAL_ANCHOR_MONTH/DAY automatically.
 */
export function formatAnchorDate(): string {
  return `${RENEWAL_ANCHOR_DAY} ${MONTH_NAMES[RENEWAL_ANCHOR_MONTH - 1]}`;
}
