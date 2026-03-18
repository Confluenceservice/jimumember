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
- Uses Stripe Checkout Sessions in `subscription` mode.
- Jan-Jun NZ window:
  - Uses fixed first-term charge (one-time upfront price) and applies 50% promo to that full annual amount.
  - Sets `subscription_data[trial_end]` to next July 1 so annual recurring billing starts on July 1.
- Jul-Dec NZ window:
  - Uses `subscription_data[billing_cycle_anchor]` with proration to next July 1.
- Allows manual promo code entry outside that window.
