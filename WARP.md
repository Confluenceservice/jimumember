# WARP Notes
Last updated: 2026-03-18

## Scope
Replace Payment Links with Checkout Sessions so membership subscriptions can:
- Anchor renewals to 1 July each year.
- Apply a 50% first-subscription discount from 1 January to 30 June.
- Keep logic server-side and auditable.

## Stripe Objects in Use (Test Mode)
- Associate product: `prod_U7vqEzAEaaK8nC`
- Professional product: `prod_U7vDD3Q6088P3i`
- Associate yearly price: `price_1T9fz1CqKoUYavpqs4Kb7p0d`
- Professional yearly price: `price_1T9fNECqKoUYavpqJr5YzSll`
- Associate upfront one-time price: `price_1TCDl2CqKoUYavpqM8IifPhj`
- Professional upfront one-time price: `price_1TCDl2CqKoUYavpqZ9tRNTf6`
- Promotion code: `LDTY8PQR`
- Active promotion code object: `promo_1TCCuCCqKoUYavpqPBHFpGBT`
- Coupon: `half` (50% off, once)

## Verified Business Logic
- Promo code is restricted to first-time transactions.
- Promo code expires at end of 30 June 2026 (NZ time).
- Initial Jan-to-Jun prorated invoices show 50% discount.
- Renewal cycle invoice at July boundary is full annual price.

## Checkout Sessions Pattern
Use `checkout.sessions.create` with:
- `mode=subscription`
- `success_url` and `cancel_url`
- Jan-Jun NZ window:
  - recurring line item + upfront one-time line item
  - `subscription_data[trial_end]=<next Jul 1 epoch>`
  - `discounts[0][promotion_code]=promo_1TCCuCCqKoUYavpqPBHFpGBT`
  - Result: 50% discount applies to full annual upfront amount.
- Jul-Dec NZ window:
  - recurring line item only
  - `subscription_data[billing_cycle_anchor]=<next Jul 1 epoch>`
  - `subscription_data[proration_behavior]=create_prorations`

## Implementation Rules
1. Keep Stripe secret keys server-side only in environment variables.
2. Never embed secret keys in frontend code or markdown.
3. Keep product and price IDs in server config, not hardcoded in templates.
4. Compute promo-window dates in `Pacific/Auckland` timezone.
5. Compute billing anchor as next 1 July boundary.
6. Enforce entitlement changes only from webhook events, not client redirects.

## Minimum Webhook Events
- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Latest Test Checkout Sessions
- Associate: `cs_test_a1dtZnS3gE4TxwZ7TViHxUOy3n2SnLxUHZaaFKtn5pZhAxl6zsc8IdVjrj`
- Professional: `cs_test_a1WuRmT0ulJuvwYQr43EK8TZYR8nMSwxc6RUMPZBEKWErSnDmRBmjVE08K`

## Current Scaffold Status
- Created Astro app scaffold with server output and Node adapter.
- Implemented checkout session API route: `src/pages/api/create-checkout-session.ts`.
- Implemented webhook scaffold route: `src/pages/api/stripe-webhook.ts`.
- Implemented frontend membership UI: `src/pages/index.astro`.
- Added success/cancel pages: `src/pages/success.astro`, `src/pages/cancel.astro`.
- Added env template: `.env.example`.
- Build and diagnostics pass (`npm run build`, `npm run check`).

## Next Steps
1. Implement idempotent membership state updates in webhook handler.
2. Add persistent storage mapping Stripe customer/subscription to local member records.
3. Add integration tests for Jan-Jun discount window and July anchor renewals.
4. Replace placeholder success/cancel URLs with production domain values.

## Guardrails For Future Changes
1. Do not change `subscription_data[billing_cycle_anchor]` logic without timezone tests.
2. Keep promo logic gated by NZ timezone month checks and Stripe first-time restriction.
3. Keep Stripe IDs in env/config, not hardcoded in frontend scripts.
4. Treat webhook updates as source of truth for entitlement changes.
