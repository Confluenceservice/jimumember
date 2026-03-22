# WARP Notes
Last updated: 2026-03-18

## Scope
Implement Option C custom flow so membership subscriptions can:
- Charge first-term amount in Checkout without Stripe trial copy on the hosted page.
- Anchor renewals to 1 July each year.
- Apply a 50% first-subscription discount from 1 January to 30 June with promo code `LDTY8PQR`.
- Keep renewal logic server-side and auditable via webhook.

## Stripe Objects in Use (Test Mode)
- Associate product: `prod_U7vqEzAEaaK8nC`
- Professional product: `prod_U7vDD3Q6088P3i`
- Associate yearly price: `price_1T9fz1CqKoUYavpqs4Kb7p0d`
- Professional yearly price: `price_1T9fNECqKoUYavpqJr5YzSll`
- Promotion code: `LDTY8PQR`
- Coupon: `half` (50% off, once)

## Verified Business Logic
- Promo code is restricted to first-time transactions.
- Promo code expires at end of 30 June 2026 (NZ time).
- Initial Jan-to-Jun prorated invoices show 50% discount.
- Renewal cycle invoice at July boundary is full annual price.

## Option C Checkout Pattern
Use `checkout.sessions.create` with:
- `mode=payment`
- one-time line item amount = first-term charge today
- `payment_intent_data[setup_future_usage]=off_session`
- metadata containing:
  - plan
  - recurring annual price id
  - next Jul 1 anchor epoch
- custom copy: `Then NZ$X per year starting 1 July.`

First-term amount logic:
- Jan-Jun NZ + first-time subscriber + promo code `LDTY8PQR`: charge 50% of annual amount.
- Otherwise: charge prorated amount to next 1 July.

Webhook behavior (`checkout.session.completed`):
- set customer default payment method from PaymentIntent
- create annual subscription with `trial_end=<next Jul 1 epoch>`
- use idempotency key derived from session id

## Implementation Rules
1. Keep Stripe secret keys server-side only in environment variables.
2. Never embed secret keys in frontend code or markdown.
3. Keep product and price IDs in server config, not hardcoded in templates.
4. Compute promo-window dates in `Pacific/Auckland` timezone.
5. Compute billing anchor as next 1 July boundary.
6. Enforce entitlement changes only from webhook events, not client redirects.

## Minimum Webhook Events
- `checkout.session.completed` (creates deferred recurring subscription)
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Latest Test Checkout Sessions
- Associate: `cs_test_a1dtZnS3gE4TxwZ7TViHxUOy3n2SnLxUHZaaFKtn5pZhAxl6zsc8IdVjrj`
- Professional: `cs_test_a1WuRmT0ulJuvwYQr43EK8TZYR8nMSwxc6RUMPZBEKWErSnDmRBmjVE08K`

## Current Scaffold Status
- Created Astro app scaffold with server output and Node adapter.
- Implemented Option C payment checkout API route: `src/pages/api/create-checkout-session.ts`.
- Implemented Option C webhook subscription creation: `src/pages/api/stripe-webhook.ts`.
- Updated frontend membership UI with promo code input and explicit 1 July wording: `src/pages/index.astro`.
- Added success/cancel pages: `src/pages/success.astro`, `src/pages/cancel.astro`.
- Added env template: `.env.example`.
- Build and diagnostics pass (`npm run build`, `npm run check`).

## Next Steps
1. Add persistent idempotency/event tracking for webhook processing.
2. Add local membership persistence mapping customer/subscription records.
3. Add integration tests for promo-code eligibility and prorated fallback.
4. Replace placeholder success/cancel URLs with production domain values.

## Guardrails For Future Changes
1. Keep first-term charge calculations in NZ timezone and test boundary dates.
2. Keep recurring subscription creation in webhook only, not on client redirect.
3. Keep recurring price IDs in env/config, not hardcoded in frontend scripts.
4. Keep webhook creation path idempotent by checkout session id.
