# Tasks — Stripe Webhook Side Effects

> Spec ID: `008` · Type: system feature
> Status: backfilled. Approval pending first webhook change.

## Phase 1: Foundation
- [x] POST `/api/stripe-webhook` endpoint
- [x] Stripe signature verification
- [x] Event ID idempotency cache (in-memory)
- [x] Dispatch by metadata.flow

## Phase 2: Option C Handler
- [x] `setApplicantPaid()` (sync)
- [x] `createApplicationReviewDoc()` (async)
- [x] `setAwaitingSubscription()` with trial_end
- [x] `sendConfirmation()` + `sendAdminNotification()` (async)

## Phase 3: Renewal Handler
- [x] `markRenewalPaid()` (sync)
- [x] `sendAdminNotification()` (async)
- [x] `sendPdLogLink()` if tier='adv' (async)

## Phase 4: Subscription Lifecycle
- [x] `invoice.payment_succeeded` → `setActive()` + confirmation
- [x] `customer.subscription.updated` → `setPaymentFailed()` if past_due

## Phase 5: Webhook URL Configuration
- [x] Staging: remember-staging.fly.dev
- [x] Production: subscribe.example.com
- [x] Documented in CLAUDE.md → migrated to `000-platform-overview`

## Phase 6: Future
- [ ] Persistent event ID store
- [ ] Dead-letter queue for failed side effects
- [ ] Refund + dispute handling

## Notes
- Spec must be re-approved if event types handled changes (REQ-SW-002).
- Async side effects are designed to be re-runnable.