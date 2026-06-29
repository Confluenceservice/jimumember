# Requirements — Stripe Checkout Flow

> Spec ID: `007` · Type: system feature · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `014-tier-abstraction`, `015-environment-configuration`
> Source today: `/api/advanced/upload-complete`, `/api/apply`, `/api/renew/checkout/[tier]`, `/api/create-checkout-session`

## Overview

Stripe Checkout Session creation for all 4 flows: basic application, advanced application (Option C deferred subscription), basic renewal, advanced renewal. Single shared `createCheckoutSession()` abstraction with per-flow metadata.

## Functional Requirements

- **REQ-SC-001** Four checkout entry points:
  - Advanced application: `POST /api/advanced/upload-complete`
  - Basic application: `POST /api/apply` → `POST /api/create-checkout-session`
  - Basic renewal: `POST /api/renew/checkout/basic`
  - Advanced renewal: `POST /api/renew/checkout/advanced`
- **REQ-SC-002** Each entry point constructs a Stripe `checkout.sessions.create({...})` call with: `mode`, `line_items`, `success_url`, `cancel_url`, `metadata`.
- **REQ-SC-003** Metadata contract (key per flow):
  - Application (Option C): `{ flow: 'option_c', plan, recurring_price_id, next_july1_epoch }`
  - Renewal: `{ flow: 'renewal', plan, tier, renewal_id, renewal_year }`
- **REQ-SC-004** Tier-aware price lookup via `getLookupKey(tier, kind)` (spec `014`). Env-var routing split (spec `015`).
- **REQ-SC-005** `success_url` and `cancel_url` derived from `PUBLIC_APP_URL` env var + per-flow path.
- **REQ-SC-006** Error handling: typed error responses with `code` enum + `retryable: boolean`. 429 honours `Retry-After` header.
- **REQ-SC-007** Retry with exponential backoff for network errors and 502/503/504 (1s, 2s, 4s delays). 400 and 429 not retried.

## Non-Functional Requirements

- **NFR-SC-001** `CHECKOUT_DRY_RUN=true` validates config without hitting Stripe. Returns `{dryRun: true, stripeKeysValidated: true}`.
- **NFR-SC-002** `STRIPE_WEBHOOK_SECRET` is required even in dry-run mode (so webhook handler doesn't 500 on first event).
- **NFR-SC-003** Inline error banner in UI (not dismissable alert); preserves form state.

## Acceptance Criteria

1. Advanced applicant at completion → POST upload-complete → Stripe Checkout URL returned → on success, applicant `paid`.
2. Basic applicant submit → Stripe Checkout URL → on success, application row `paid`.
3. Renewal submit → Stripe Payment Link (hosted page) → on success, Renewals row `paid`.
4. `CHECKOUT_DRY_RUN=true` → no network call to Stripe; response `{dryRun: true, stripeKeysValidated: true}`.
5. Network drop during checkout creation → 3 retries with 1s/2s/4s backoff; final failure shows error banner.
6. 429 from Stripe → response includes `Retry-After` value; UI shows friendly wait message.
7. Staging: `STAGING_PREFIX=STAGING_` → `STRIPE_STAGING_PRICE_*` resolved.

## Out of Scope

- Stripe Customer creation (customers created on first checkout via `customer_email`).
- Subscription creation (handled in webhook per Option C).
- Refund flow (admin handles via Stripe Dashboard).

## Related

- `src/lib/stripe.ts` — checkout session creation
- `src/pages/api/advanced/upload-complete.ts` — advanced completion flow
- `src/pages/api/create-checkout-session.ts` — basic application flow
- `src/pages/api/renew/checkout/[tier].ts` — renewal flow
- Spec `008` — webhook side effects