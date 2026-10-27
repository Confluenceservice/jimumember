# Requirements — Payment Provider Abstraction

> Spec ID: `017` · Type: cross-cutting · Status: draft
> Depends on: `007-stripe-checkout-flow`, `008-stripe-webhook-side-effects`, `011-health-monitoring-alerting`, `014-tier-abstraction`, `015-environment-configuration`
> Design: `docs/superpowers/specs/2026-10-27-airwallex-provider-design.md`
> Plan 1 (seam + Stripe adapter): `docs/superpowers/plans/2026-10-27-payment-seam-stripe-adapter.md`

## Overview

A fork chooses one payment provider (Stripe or Airwallex) per deployment. Payment code is reached only through a provider-neutral interface in `src/lib/payments/`; the Stripe adapter keeps today's behaviour exactly. Spec 016 (Xero adapter) is reserved and consumes the neutral payment events defined here.

## Functional Requirements

- **REQ-PP-001** Provider is selected by `PAYMENT_PROVIDER` (`stripe` | `airwallex`), default `stripe`. An unknown value is an error. Until the Airwallex adapter ships, `airwallex` is rejected with a clear error.
- **REQ-PP-002** A provider-neutral `PaymentProvider` interface owns price resolution, returning-customer lookup, checkout creation/lookup, subscription creation, webhook parsing and health probing. Routes and side-effect modules never import a provider SDK.
- **REQ-PP-003** The Stripe adapter is behaviour-identical to the pre-017 code: same API parameters, idempotency keys, metadata keys, response JSON and status codes. Documented exceptions are listed in plan 1, Task 6.
- **REQ-PP-004** Webhook domain logic consumes neutral `PaymentEvent`s. Events carry what a ledger entry needs (provider, gross amount, currency, provider reference, paid-at, payer) so spec 016 can serve every provider.
- **REQ-PP-005** Exactly one Stripe client factory with exactly one pinned `apiVersion` literal.
- **REQ-PP-006** `/api/health` probes the active provider; the response JSON shape is unchanged in plan 1.

## Planned (later plans)

- **REQ-PP-007** Sheet headers `stripe_session` → `payment_ref`; `provider` column on Memberships and checkout log.
- **REQ-PP-008** `/api/health` exposes `payment: { provider, ok }`, keeping `stripe` as an alias for one release.
- **REQ-PP-009** Airwallex adapter (Billing Checkout, Billing subscriptions, HMAC webhook verification).
- **REQ-PP-010** Airwallex is for new deployments only: startup fails if the Memberships sheet holds active Stripe members.

## Out of Scope

Both providers live at once; Stripe→Airwallex cutover; refunds UI; Xero (spec 016).
