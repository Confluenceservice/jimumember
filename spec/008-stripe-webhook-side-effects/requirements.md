# Requirements — Stripe Webhook Side Effects

> Spec ID: `008` · Type: system feature · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `005-membership-renewal`, `007-stripe-checkout-flow`, `009-email-notifications`, `010-admin-application-review`
> Source today: `/api/stripe-webhook`

## Overview

Stripe sends webhook events for checkout completion, subscription updates, and invoice payments. Each event triggers side effects: sheet updates, email sends, doc generation. Webhook signature verified against `STRIPE_WEBHOOK_SECRET`.

## Functional Requirements

- **REQ-SW-001** Single endpoint: `POST /api/stripe-webhook`. Stripe signature verified; rejected on mismatch.
- **REQ-SW-002** Events handled:
  - `checkout.session.completed` — application (Option C) + renewal completion
  - `invoice.payment_succeeded` — recurring renewal invoice paid
  - `customer.subscription.updated` — subscription state change (e.g. past_due)
- **REQ-SW-003** Dispatch by `metadata.flow`:
  - `flow: 'option_c'` → `getMembership()` + `setAwaitingSubscription()` + create subscription with `trial_end` + create review doc + send confirmation + send admin notification
  - `flow: 'renewal'` → `markRenewalPaid()` + admin notification + (advanced only) PD-log link email
- **REQ-SW-004** Idempotency: same Stripe event ID processed twice → second is no-op. Use event ID cache (in-memory or Sheets).
- **REQ-SW-005** All side effects non-blocking where possible: email send + doc creation fire-and-forget; sheet update is synchronous (must succeed before 200 response).
- **REQ-SW-006** Webhook responds 200 within 5s. Slow side effects are offloaded to background work.
- **REQ-SW-007** Failure logging: any side effect failure logs error via pino with event ID + flow + identifiers.

## Non-Functional Requirements

- **NFR-SW-001** Webhook URL per environment:
  - Staging: `https://remember-staging.fly.dev/api/stripe-webhook`
  - Production: `https://subscribe.example.com/api/stripe-webhook`
- **NFR-SW-002** Replay support: if webhook URL was wrong during a successful payment, fix in Stripe Dashboard and replay `checkout.session.completed`.

## Acceptance Criteria

1. Application payment → webhook fires → applicant `paid=TRUE`, `paid_at` set, review doc created, confirmation email sent.
2. Renewal payment → webhook fires → Renewals row `paid`, admin notified, advanced PD-log link email sent.
3. `invoice.payment_succeeded` for subscription → `setActive()` + confirmation email.
4. `customer.subscription.updated` to `past_due` → `setPaymentFailed()`.
5. Same event ID replayed → no double side effects.
6. Side effect failure (e.g. Mailgun 500) → logged + 200 returned (Stripe must not retry infinitely).

## Out of Scope

- Refund handling (admin via Dashboard).
- Dispute handling.
- Subscription cancellation flow (membership year ends; no auto-cancel).

## Related

- `src/pages/api/stripe-webhook.ts` — handler
- `src/lib/memberships.ts` — in-memory subscription state
- Specs `005`, `009`, `010` — downstream side effects