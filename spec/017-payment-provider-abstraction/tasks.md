# Tasks — Payment Provider Abstraction

See `docs/superpowers/plans/2026-10-27-payment-seam-stripe-adapter.md` (plan 1: Tasks 0–9). Plans 2 and 3 are written later.

- [x] Task 0: spec skeleton
- [x] Task 1: characterization tests
- [x] Task 2: membership-terms extraction
- [x] Task 3: types + registry
- [x] Task 4: Stripe adapter (client, prices, customers, health)
- [x] Task 5: Stripe adapter (checkout, subscription, webhook parsing)
- [x] Task 6: routes onto provider
- [x] Task 7: shared event handler + thin webhook route
- [x] Task 8: health via provider
- [x] Task 9: final verification + docs

## Plan 2 — `docs/superpowers/plans/2026-10-28-sheet-health-migration.md`

- [x] Task 1: `stripe_session` → `payment_ref` in code
- [x] Task 2: Memberships `provider` column (J)
- [x] Task 3: Checkout Log `provider` column (J)
- [x] Task 4: `/api/health` `payment` key + `stripe` alias
- [x] Task 5: alert worker reads `payment` ?? `stripe`
- [x] Task 6: provider-neutral dry-run copy
- [x] Task 7: docs, upgrade notes, spec status
- [x] Task 8: final verification
