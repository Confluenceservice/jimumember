# ELDAA Membership Checkout Scaffold
Astro SSR app with:
- Associate membership checkout (`/`) — `src/pages/index.astro`
- Professional membership checkout (`/professional`) — `src/pages/professional.astro`
- Checkout Session backend routes (`/api/create-checkout-session`, `/api/create-professional-checkout`)
- Stripe webhook endpoint (`/api/stripe-webhook`) with Google Sheets logging
- Session info API (`/api/session-info`)

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
- First-time subscribers: prorated first-term charge based on weeks remaining until 1 July.
- Existing subscribers: full annual amount (no proration).
- Professional checkout redirects to `eldaa.org.nz/professional-membership` after payment.
- Professional application resume emails are sent via Gmail API (`/api/professional/apply`).

## Transactional email setup (Gmail API)
- Required env vars:
  - `GMAIL_SENDER_EMAIL`
  - `GMAIL_OAUTH_CLIENT_ID`
  - `GMAIL_OAUTH_CLIENT_SECRET`
  - `GMAIL_OAUTH_REFRESH_TOKEN`
- Local fallback: if OAuth env vars are not set, the app can use Application Default Credentials (ADC) with `gmail.send` scope.
- Ops runbook: `docs/runbooks/gmail-oauth-token-rotation.md`

## Stripe webhook endpoints
- Staging (`eldaa`): `https://eldaa.fly.dev/api/stripe-webhook`
- Production (`eldaa-production`): `https://subscribe.eldaa.org.nz/api/stripe-webhook`

If a payment succeeded while the webhook URL was incorrect, fix the endpoint in Stripe and replay the `checkout.session.completed` event to backfill post-payment side effects.
