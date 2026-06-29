# Tasks — Membership Renewal

> Spec ID: `005` · Type: member-facing feature
> Status: backfilled. Approval pending first renewal-flow change.

## Phase 1: Basic Renewal (Phase B)
- [x] `renewBasic.ts` schema (firstName, lastName, email, year)
- [x] `renewBasic.content.json`
- [x] Dynamic `/renew/[tier].astro`
- [x] Dynamic `/api/renew/checkout/[tier].ts`

## Phase 2: Advanced Renewal (Phase G)
- [x] `renewAdvanced.ts` schema (adds phone, pdEntries passthrough)
- [x] Phone validation (`phoneNZ`)
- [x] pdEntries passed to `appendRenewal` + Stripe metadata

## Phase 3: Stripe Integration
- [x] `STRIPE_PRICE_{1,2}_RENEWAL` lookup
- [x] One-time payment (mode=payment)
- [x] Payment Link hosted page
- [x] Metadata: flow='renewal', tier, renewal_id, renewal_year

## Phase 4: Webhook Completion
- [x] `markRenewalPaid()` flips payment_status
- [x] `amountPaidCents` + `paid_at` set
- [x] Admin notification
- [x] PD-log link email (advanced only)

## Phase 5: Session Info
- [x] GET `/api/renew/session-info` for post-checkout UI

## Phase 6: Future
- [ ] Auto-renewal subscriptions
- [ ] Tier upgrade/downgrade
- [ ] Multi-year renewal

## Notes
- Renewals share one Sheet tab; tier column (B) discriminates.
- One-time payment only; no subscription proration.