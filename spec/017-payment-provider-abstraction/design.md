# Design — Payment Provider Abstraction

Source of truth: `docs/superpowers/specs/2026-10-27-airwallex-provider-design.md` (approved 2026-10-27).

Plan 1 introduces `src/lib/payments/` (`types.ts`, `errors.ts`, `index.ts`, `handle-payment-event.ts`, `stripe/`). Routes call `getPaymentProvider()`; `/api/stripe-webhook` is a thin route that calls `provider.parseWebhook()` and hands the neutral event to `handlePaymentEvent()`.
