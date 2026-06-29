# Requirements — Membership Renewal

> Spec ID: `005` · Type: member-facing feature · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `012-form-schema-system`, `014-tier-abstraction`, `015-environment-configuration`
> Source today: `renewBasic.ts` + `renewAdvanced.ts` + `/api/renew/checkout/[tier]` + Renewals sheet

## Overview

Existing members renew annually. Single payment per renewal (no subscription). Stripe Payment Link hosted page; one schema-driven form per tier. Renewals stored in a single shared Renewals sheet (14 cols).

## Functional Requirements

- **REQ-MR-001** Two tiers: `basic` renewal and `advanced` renewal. Each has its own schema (`renewBasic.ts`, `renewAdvanced.ts`).
- **REQ-MR-002** Basic renewal fields: firstName, lastName, email, year. Advanced adds: phone.
- **REQ-MR-003** `year` is the renewal year (e.g. 2026). Used by webhook for receipt + admin notification.
- **REQ-MR-004** One-time payment only: `mode=payment`, not `subscription`. Hosted Stripe Payment Link per tier.
- **REQ-MR-005** Stripe env-var lookup: `STRIPE_PRICE_{1,2}_RENEWAL` resolves to the per-tier renewal price. Tier→index mapping via `getLookupKey(tier, 'renewal')`.
- **REQ-MR-006** On submit: append Renewals sheet row (14 cols) with `payment_status = "pending"`, `tier`, `renewal_id = UUID`, `created_at`. Redirect to Stripe Payment Link.
- **REQ-MR-007** On webhook `checkout.session.completed` with `flow: "renewal"`: lookup `renewal_id` from metadata, flip `payment_status` to `"paid"`, set `paid_at`, send admin notification + (advanced only) PD-log link email.
- **REQ-MR-008** `GET /api/renew/session-info?session_id=X` returns `{ tier, renewalYear, amountPaidCents }` for post-checkout confirmation UI.

## Non-Functional Requirements

- **NFR-MR-001** Renewal form is shorter than application: no document upload, no declarations.
- **NFR-MR-002** Mobile-friendly; advanced form includes phone validation (`phoneNZ`).

## Acceptance Criteria

1. Basic member submits renewal → Renewals row appended with `tier='basic'`.
2. Advanced member submits renewal → Renewals row appended with `tier='adv'`, `phone` populated.
3. Stripe webhook `checkout.session.completed` → row flips to `paid`, `paid_at` set.
4. Advanced renewal → PD-log link email sent within 30s of webhook.
5. Basic renewal → no PD-log email (basic has no PD requirement).
6. `STRIPE_PRICE_1_RENEWAL` env-var resolution works for both staging + production via `STAGING_PREFIX`.

## Out of Scope

- Auto-renewal subscriptions (one-time only by design).
- Proration for mid-year tier changes.
- Multi-year renewal (single year at a time).

## Related

- `src/lib/forms/schemas/renewBasic.ts` + `renewAdvanced.ts`
- `src/pages/api/renew/checkout/[tier].ts`
- `src/lib/renewal-sheet.ts` — `appendRenewal()`, `markRenewalPaid()`
- Spec `006` — PD logging (advanced post-renewal)
- Spec `008` — webhook side effects