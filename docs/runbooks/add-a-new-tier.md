# Runbook — Add a new membership tier

Use this when introducing a third (or fourth) tier beyond Professional and Associate. See `docs/forms/composing-a-tier.md` for the conceptual walkthrough; this runbook is the step-by-step ops checklist.

## Checklist

- [ ] **Decide the storage value code.** 2-3 letter code used in the Renewals sheet `tier` column + Stripe `metadata.tier`. Don't collide with `"pm"` or `"am"`. Pick once and treat as immutable.
- [ ] **Add Stripe products.** One for application, one for renewal. Both annual recurring, NZD. Capture both price IDs.
- [ ] **Set env vars** (local + Fly secrets):
  - `STRIPE_PRICE_<TIER>` (application)
  - `STRIPE_PRICE_<TIER>_RENEWAL` (renewal)
  - Update `.env.example` to document them.
- [ ] **Add the tier entry** in `src/lib/forms/tiers.ts`. Use a 2-letter UPPERCASE prefix for env vars (matching existing convention: `STRIPE_PRICE_PROFESSIONAL`).
- [ ] **Create the schemas:**
  - `src/lib/forms/schemas/<tier>Apply.{ts,content.json}` — application form
  - `src/lib/forms/schemas/renew<tier>.{ts,content.json}` — renewal form
- [ ] **Decide the sheet tab name** (e.g. `"Student Applications"`). Document the column layout in `docs/forms/migration-map.md`.
- [ ] **Create the sheet tab** in the spreadsheet with the headers you documented.
- [ ] **Wire up the API routes:**
  - `src/pages/api/<tier>-checkout.ts` (or extend an existing one) — application flow
  - `src/pages/api/renew/checkout/[tier].ts` already supports arbitrary tier slugs as long as the entry is in `TIERS` + `resolveRenewalPriceByTier(<tier>)` returns a price.
- [ ] **Create the Astro page:** `src/pages/<tier>-apply.astro` (or `src/pages/renew/<tier>.astro`).
- [ ] **Update CUSTOMIZE.md section 5** with the new Stripe env vars.
- [ ] **Update CUSTOMIZE.md section 7a** with the new schemas.
- [ ] **Tests:**
  - `src/lib/forms/tiers.test.ts` — `getTier("<tier>")` returns the new config; `listTiers()` includes the new entry.
  - `src/lib/forms/schemas/renew<tier>.test.ts` — schema-level tests.
  - `src/lib/stripe-products.test.ts` — `resolveRenewalPriceByTier("<tier>")` reads the right env var.
- [ ] **End-to-end smoke on staging:**
  - [ ] Submit application → sheet row appears with correct values
  - [ ] Submit renewal → sheet row + Stripe `metadata.tier=<your code>` matches
  - [ ] Webhook fires → admin email + sheet `payment_status` flips to `"paid"`
  - [ ] `getRenewalById(renewalId)` returns the row with the correct tier (data-driven reader, no code change needed)

## What's automatic

- `getTier(slug)` lookup
- `validateTier(slug, body)` schema dispatch
- `getRenewalById` recognising the storage value
- `checkout/[tier].astro` and `checkout/[tier].ts` routing (already data-driven)