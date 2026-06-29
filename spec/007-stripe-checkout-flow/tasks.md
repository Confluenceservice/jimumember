# Tasks — Stripe Checkout Flow

> Spec ID: `007` · Type: system feature
> Status: backfilled. Approval pending first checkout-flow change.

## Phase 1: Core Abstraction
- [x] `src/lib/stripe.ts` `createCheckoutSession()`
- [x] Tier-aware price lookup
- [x] Metadata construction per flow
- [x] `success_url` / `cancel_url` derivation

## Phase 2: Entry Points
- [x] POST `/api/advanced/upload-complete`
- [x] POST `/api/create-checkout-session` (basic)
- [x] POST `/api/renew/checkout/[tier]`
- [x] All 4 flows wired

## Phase 3: Resilience
- [x] Retry with exponential backoff (1s/2s/4s)
- [x] 429 → Retry-After surfaced to user
- [x] Typed error responses (code + retryable)
- [x] Inline error banner (preserves form state)
- [x] Token persistence across retries

## Phase 4: Dry Run
- [x] `CHECKOUT_DRY_RUN` flag accepted (true/1/yes/on)
- [x] Validates config without hitting Stripe
- [x] Returns `{dryRun: true, stripeKeysValidated: true}`
- [x] `STRIPE_WEBHOOK_SECRET` still required

## Phase 5: Option C Metadata
- [x] `flow: 'option_c'`
- [x] `recurring_price_id`
- [x] `next_july1_epoch`
- [x] `subscription_data.trial_end`

## Notes
- Spec must be re-approved if metadata contract changes (REQ-SC-003).
- Dry-run mode is the recommended way to validate Stripe config in new environments.