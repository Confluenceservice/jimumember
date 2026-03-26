# WARP Notes
Last updated: 2026-03-23

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
- Initial Jan-to-Jun invoices show 50% discount.
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
- Otherwise: charge full amount to next 1 July.

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
- Deployed to Fly.io at `https://eldaa.fly.dev/` with Dockerfile + fly.toml.
- Webhook tested successfully via `stripe trigger checkout.session.completed`.
- Unit tests for business logic: `src/lib/stripe-checkout.test.ts`, `src/lib/memberships.test.ts`.

## Next Steps
1. ~~Add persistent idempotency/event tracking for webhook processing.~~ (done via idempotencyKey + local membership store)
2. ~~Add local membership persistence mapping customer/subscription records.~~ (done in `.data/memberships.json`)
3. Add integration tests for promo-code eligibility and prorated fallback.
4. ~~Replace placeholder success/cancel URLs with production domain values.~~ (done — eldaa.fly.dev)
5. Configure production Stripe webhook in Dashboard (register `https://eldaa.fly.dev/api/stripe-webhook`).
6. Switch from test keys to live Stripe keys before going live.

## Guardrails For Future Changes
1. Keep first-term charge calculations in NZ timezone and test boundary dates.
2. Keep recurring subscription creation in webhook only, not on client redirect.
3. Keep recurring price IDs in env/config, not hardcoded in frontend scripts.
4. Keep webhook creation path idempotent by checkout session id.

## Deployment (Fly.io)

### Files
- `Dockerfile` — multi-stage Node.js build
- `.dockerignore` — excludes node_modules, dist, tests, env files
- `fly.toml` — app config (1x shared CPU, 256MB RAM, Sydney region)

### Commands
```bash
fly launch                    # First-time setup (already done — app: eldaa)
fly deploy                    # Deploy to Fly.io
fly secrets set KEY=value    # Set secrets
fly machines list            # List running machines
fly machines stop <id>       # Stop machine
fly machines start <id>      # Start machine
```

### Required Secrets
```bash
fly secrets set STRIPE_SECRET_KEY=sk_live_...
fly secrets set STRIPE_WEBHOOK_SECRET=whsec_...
fly secrets set STRIPE_PRICE_ASSOCIATE=price_...
fly secrets set STRIPE_PRICE_PROFESSIONAL=price_...
fly secrets set PUBLIC_SITE_URL=https://eldaa.fly.dev
```

### Stripe Webhook (Production)
Register in Stripe Dashboard → Developers → Webhooks:
- URL: `https://eldaa.fly.dev/api/stripe-webhook`
- Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`

### Testing Webhooks Locally
```bash
stripe listen --forward-to https://eldaa.fly.dev/api/stripe-webhook
```
Note: Always use `https://` — Stripe CLI doesn't follow HTTP→HTTPS redirects.

### Scaling
`fly.toml` sets `max_machines = 1` and `min_machines_running = 0` — machines stop when idle and start on traffic. Currently running 1x shared-cpu-1x with 256MB RAM.

### Env Var Note
Server-side code uses `process.env.*` (not `import.meta.env.*`) for env vars. `import.meta.env` does not reliably expose runtime env vars in Fly.io's Node.js SSR container.

## Deploying Elsewhere

The Dockerfile is a standard multi-stage Node.js build. It builds the Astro SSR app and runs it as a standalone Node.js server.

### Build Image
```bash
docker build -t eldaa-membership .
```

### Run Container
```bash
docker run -p 4321:4321 \
  -e STRIPE_SECRET_KEY=sk_... \
  -e STRIPE_WEBHOOK_SECRET=whsec_... \
  -e STRIPE_PRICE_ASSOCIATE=price_... \
  -e STRIPE_PRICE_PROFESSIONAL=price_... \
  -e PUBLIC_SITE_URL=https://your-domain.com \
  eldaa-membership
```

### Key Details
- **Base image**: `node:22-alpine`
- **Port**: 4321 (set `PORT=4321`, `HOST=0.0.0.0`)
- **Entry point**: `node dist/server/entry.mjs`
- **Dependencies**: installed via `npm install` (not `npm ci` — no lockfile required)
- **Build artifact**: Astro SSR output in `dist/`
- **User**: runs as root (no explicit USER set — adjust for non-test deployments)

### Cloudflare Tunnel (alternative to Fly.io)
Run the container internally (no direct public internet), then expose via Cloudflare tunnel.

**1. Create a Docker network:**
```bash
docker network create eldaa-net
```

**2. Run the app container privately (no port exposed to host):**
```bash
docker run --network eldaa-net --name eldaa-app \
  -e STRIPE_SECRET_KEY=sk_... \
  -e STRIPE_WEBHOOK_SECRET=whsec_... \
  -e STRIPE_PRICE_ASSOCIATE=price_... \
  -e STRIPE_PRICE_PROFESSIONAL=price_... \
  -e PUBLIC_SITE_URL=https://your-domain.com \
  eldaa-membership
```

**3. Run cloudflared as a container (no install needed):**
```bash
docker run --network eldaa-net cloudflare/cloudflared tunnel \
  --url http://eldaa-app:4321
```
`cloudflared` is the official Cloudflare container image — no host install required.

This outputs a `*.trycloudflare.com` URL. For a permanent tunnel, create one in Cloudflare Zero Trust → Tunnels, then point it to `http://eldaa-app:4321`.

**Env var for self-hosted:** Set `PUBLIC_SITE_URL` to your Cloudflare tunnel domain (e.g., `https://eldaa.yourdomain.com`).

**Note:** This does not affect Fly.io deployment — Fly uses its own wireguard network and TLS termination by default.
Server-side code uses `process.env.*` (not `import.meta.env.*`) for env vars. `import.meta.env` does not reliably expose runtime env vars in Fly.io's Node.js SSR container.
