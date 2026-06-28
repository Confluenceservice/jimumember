# Runbook — Stripe first products + webhook endpoint

Use this when standing up Stripe for a new client deployment. Run after Phase 4 (Sheets) and before Phase 9 (Fly secrets). Cross-ref `docs/DEPLOY.md` for the full phase map.

## 1. Use the client's Stripe account

Stripe is **per-client** (see Phase 0 tenancy decision in `DEPLOY.md`). The client provides the API keys — the deploying party never shares their own. You'll need:

- `sk_test_…` secret key (test mode, for staging)
- `sk_live_…` secret key (live mode, for production) — only set this on the production Fly app
- Two webhook signing secrets (one per endpoint)

The client's admin grants your deploying-party user access to their Stripe dashboard under **Settings → Team → Invite user**.

## 2. Create two products (one per tier)

In Stripe Dashboard → Products → **Add product**:

| Product | Description | Recurring? |
|---|---|---|
| `<Client> Basic Membership` | Associate-equivalent tier | Annual |
| `<Client> Advanced Membership` | Professional-equivalent tier | Annual |

For each product, add **two prices**. The recurring/one-time type is load-bearing — Re:Member's checkout flows depend on it:

| Price | Amount | Type | Use |
|---|---|---|---|
| Application price | e.g. NZD 75.00 | **Recurring (annual)** | Goes into `STRIPE_PRICE_1` / `STRIPE_PRICE_2`. The application checkout charges a one-time prorated first term, then the webhook creates a deferred subscription using this recurring price. |
| Renewal price | e.g. NZD 75.00 / 150.00 | **One-time** | Goes into `STRIPE_PRICE_<N>_RENEWAL`. The renewal checkout runs `mode: payment`, which rejects recurring prices. |

> **Common mistake:** making the application price one-time and the renewal price recurring (the intuitive-but-wrong mapping). The application flow needs a recurring price to seed the deferred subscription; the renewal flow needs a one-time price because it's a `mode: payment` checkout. `bin/setup-stripe-test.sh` gets this right automatically — prefer it over manual creation.

Copy each price ID (`price_…`) into a scratch file. They will land in `.env.staging.local` and `.env.production.local` later — and ultimately in Fly secrets (Phase 9).

## 3. Map price IDs to env vars (enumerated numbering)

The numbering follows the tier definition order in `src/lib/forms/tiers.ts`. The mapping is documented in the comment block at the top of that file:

| Tier slug | Index N | Application env var | Renewal env var |
|---|---|---|---|
| `basic` | 1 | `STRIPE_PRICE_1` | `STRIPE_PRICE_1_RENEWAL` |
| `advanced` | 2 | `STRIPE_PRICE_2` | `STRIPE_PRICE_2_RENEWAL` |
| (3rd tier, e.g. `student`) | 3 | `STRIPE_PRICE_3` | `STRIPE_PRICE_3_RENEWAL` |

Verify the mapping by opening `src/lib/forms/tiers.ts` — the `TIERS` object's first key is `basic` (1), second is `advanced` (2), etc.

## 4. Create the webhook endpoints

In Stripe Dashboard → Developers → Webhooks → **Add endpoint**:

### Staging endpoint
- URL: `https://<client>-staging.fly.dev/api/stripe-webhook`
- API version: latest
- Events to send:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

Click **Add endpoint**, then **Reveal** the Signing secret. Copy `whsec_…` into `.env.staging.local` as `STRIPE_WEBHOOK_SECRET`.

### Production endpoint
- URL: `https://<client-domain>/api/stripe-webhook` (or `https://<client>-production.fly.dev/api/stripe-webhook` if not on a custom domain)
- Same 6 events
- Copy the signing secret into `.env.production.local` as `STRIPE_WEBHOOK_SECRET`

## 5. End-to-end verification (before handing off to Phase 9)

From the Stripe CLI against staging:

```sh
stripe trigger checkout.session.completed
```

Check the Stripe Dashboard → Developers → Webhooks → click the staging endpoint → **Logs** tab. Expect HTTP 200 on the latest delivery.

Then test a renewal price lookup:

```sh
curl -sS https://<client>-staging.fly.dev/api/health | jq '.renewal_prices'
```

Expect: both `advanced` and `basic` show `"ok": true` with a priceId matching the IDs you created.

## What's automatic

- Currency (`nzd`) is enforced by `src/lib/stripe-products.ts` — every `resolveRenewalPrice()` rejects non-NZD prices. Don't create prices in a different currency without changing `src/lib/stripe-products.ts:72` first (deserves a PR).
- `STRIPE_PRICE_<N>` numbering is owned by `src/lib/forms/tiers.ts`. Re-ordering tiers there is a code change, not a secrets change.

## Rollback

Re-running this runbook with new values is safe — delete the old products/webhook endpoints in the Stripe dashboard first to avoid duplicate webhook deliveries. The webhook endpoint URL is the only non-idempotent part (Phase 7 in `DEPLOY.md`).