# ELDAA Membership Checkout Scaffold
Astro scaffold with:
- Frontend membership page (`src/pages/index.astro`)
- Checkout Session backend route (`src/pages/api/create-checkout-session.ts`)
- Stripe webhook endpoint scaffold (`src/pages/api/stripe-webhook.ts`)

## Quick start
1. Install dependencies:
   - `npm install`
2. Copy env template:
   - `cp .env.example .env`
3. Update `.env` values.
4. Run locally:
   - `npm run dev`

## Key behavior
- Uses Stripe Checkout Sessions in `payment` mode for the first-term charge.
- Webhook creates the annual recurring subscription after successful payment.
- Annual recurring billing is deferred to 1 July (handled server-side in webhook).
- Jan-Jun NZ window: first-time subscribers with valid promo code (`LDTY8PQR`) get 50% off the annual amount.
- Otherwise, first-term charge is prorated to the next 1 July boundary.
