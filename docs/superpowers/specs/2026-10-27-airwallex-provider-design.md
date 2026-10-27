# Airwallex as alternative payment provider — design

## Context

JimuMember is a blueprint other orgs fork. Payments are hard-wired to Stripe: 10 sites build their own `new Stripe(...)`, no abstraction layer, Stripe IDs in sheet column headers, health JSON key `stripe`. Goal: a fork picks Stripe **or** Airwallex at deploy time. No specific org waiting — this is blueprint hardening; verified against Airwallex sandbox (`api.sandbox.airwallex.com`), not a live merchant.

## Decided by user

- One provider per deployment, chosen by config. No payer-side choice, no mixing providers across flows.
- Full parity day one: associate signup, professional application fee, both renewal tiers, webhook side effects (Sheets, review Docs, emails), `/api/health`.
- Year-2+ auto-renewal on Airwallex uses **Airwallex Billing subscriptions** (same member experience as Stripe today). Forks on Airwallex must have Billing enabled — documented requirement.
- Stripe stays default. Small, documented migration for existing Stripe forks is acceptable.
- Airwallex is for **new deployments only**. No Stripe→Airwallex cutover. Guard: with `PAYMENT_PROVIDER=airwallex`, startup (and `/api/health`) fails loudly if the Memberships sheet holds any `active`/`awaiting_subscription` row whose `provider` is `stripe` or blank. Documented in `docs/CUSTOMIZE.md`.
- Returning members on Airwallex pay full annual price, same as Stripe: seam gets `findReturningCustomer(email) → { customerRef, hadSubscription } | null`. Stripe adapter = today's `customers.list` + `subscriptions.list` logic (`create-checkout-session.ts:49-69`), unchanged. Airwallex adapter searches Billing customers by email; if the API cannot search by email, fall back to Memberships sheet lookup by email (Airwallex only).

## Goals / non-goals / anti-goals

- Goals: provider seam in `src/lib/payments/`; Stripe adapter = today's behaviour moved behind it; Airwallex adapter; docs + tests.
- Non-goals: both providers live at once; refunds UI; Airwallex backfill script equivalent to `bin/memberships-backfill.js` (doc gap noted); fixing unrelated bugs found in recon (`invoice.paid` vs `invoice.payment_succeeded` in setup script, dead `handleInvoicePaymentFailed` filter) — file as separate issues.
- Anti-goals: a Stripe fork silently breaking (charging wrong amount, losing webhooks, health alert going quiet); provider-specific code leaking back into routes or side-effect modules.

## Design (my calls unless marked above)

**Selection.** `PAYMENT_PROVIDER=stripe|airwallex`, default `stripe`. Read once in `src/lib/payments/index.ts` → `getPaymentProvider()`. Unknown value = boot-time error.

**Interface** (`src/lib/payments/types.ts`). Money = integer minor units + ISO currency everywhere inside app; Airwallex adapter converts to decimal at the boundary.
- `resolvePrice(tierSlug, kind: "application" | "renewal") → { priceRef, currency, unitAmount }` — replaces `stripe-products.ts` + `get-prices.ts` + inline `prices.retrieve` calls.
- `createCheckout(input) → { redirectUrl, checkoutRef }` with `mode: "one_time" | "first_term_then_annual"` (Option C), amount, priceRef, metadata (neutral keys already used: `flow`, `plan`, `applicant_id`, `renewal_id`, `basic_application_id`, …), success/cancel URLs, idempotency key, customer email.
- `getCheckout(checkoutRef)` — for success pages (`session-info.ts`, `renew/session-info.ts`).
- `parseWebhook(rawBody, headers) → PaymentEvent | null` — verifies signature, maps to neutral events: `checkout_completed`, `subscription_started`, `renewal_charged`, `renewal_failed`, `subscription_cancelled`. Carries `providerRef`, `customerRef`, `subscriptionRef`, amount, currency, metadata.
- `ensureSubscription(event)` — Option C step that creates the recurring subscription after first-term payment (Stripe: today's `subscriptions.create` with `trial_end` + idempotency key `option_c_sub_<ref>`).
- `healthCheck() → { ok, detail }`.

**Stripe adapter** (`src/lib/payments/stripe/`). Move existing logic verbatim; one shared client factory with the pinned `apiVersion` literal (single site — fixes the 5 pinned / 5 unpinned mix). Behaviour unchanged.

**Airwallex adapter** (`src/lib/payments/airwallex/`). Raw `fetch` + cached bearer token (login `POST /api/v1/authentication/login`, 30-min token, refresh on `expires_at`); Node SDK is beta, not used. Checkout via **Billing Checkout** (`POST /api/v1/billing/billing_checkouts/create`, returns server-side `url`). Webhook verify: `HMAC-SHA256(secret, x-timestamp + rawBody)` hex vs `x-signature`, constant-time, reject skew > 5 min. No event-id store (my call): Fly restarts would wipe an in-memory set and a new sheet tab adds a column contract. Instead every Airwallex side effect is idempotent the way Stripe's are — sheet checks keyed on `payment_ref` (`getRenewalByStripeRef` → renamed `getRenewalByPaymentRef`), Memberships upsert, Airwallex `request_id` on subscription creation. Prices = Airwallex Billing price IDs in env.

**Option C on Airwallex** — required behaviour: prorated first-term charge at signup, then full annual price auto-charged each anchor date (`RENEWAL_ANCHOR_MONTH/DAY`). Mechanism (subscription with trial/start date vs SETUP-mode checkout then subscription) is builder's call after a sandbox spike. If Billing cannot express it, stop and come back — do not silently downgrade to emailed renewal links.

**Webhook routing.** Shared domain handler `src/lib/payments/handle-payment-event.ts` holds everything now in `stripe-webhook.ts` handlers (Sheets, Docs, emails, Memberships mirror). Routes: keep `/api/stripe-webhook` (no URL change for Stripe forks); add `/api/airwallex-webhook`. Each route: raw body → `provider.parseWebhook` → shared handler. Route rejects if its provider isn't the active one. Rate-limit exemption in `src/middleware.ts` extended.

**Config / env.** Tier config gets a provider-neutral price index; env name built per provider: `STRIPE_PRICE_{N}[_RENEWAL]` (unchanged) and `AIRWALLEX_PRICE_{N}[_RENEWAL]`. New: `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY`, `AIRWALLEX_WEBHOOK_SECRET`, `AIRWALLEX_ENV=demo|prod`. `CURRENCY` in `src/lib/config.ts` becomes upper-case ISO internally (adapters lower-case for Stripe). Professional checkout reads price from tier config (drops hardcoded `STRIPE_PRICE_2` in `upload-complete.ts:77`).

**Sheets (the migration).** Column letters unchanged (production contract). Header renames: `stripe_session` → `payment_ref` (applicant AQ, Renewals L, Basic Applications tab in `bin/setup-google-workspace.js`); Memberships `customer_id` and `recurring_price_id` keep names but hold provider IDs; add `provider` column at end of Memberships (J) and Checkout log (J). `bin/setup-google-workspace.js` updated. Migration note in `docs/CUSTOMIZE.md` + CHANGELOG/upgrade notes.

**Health.** `/api/health` returns `payment: { provider, ok, … }` and keeps `stripe` key as alias for one release; `.run/health-alert-worker/worker.mjs` reads `payment ?? stripe`.

**Dry run.** `CHECKOUT_DRY_RUN` handled in `src/lib/payments/index.ts` (validates provider config, returns fake redirect); UI copy "Stripe configuration validated" → "Payment configuration validated".

**Xero (spec 016, not yet built).** Only a placeholder exists: comment at `stripe-webhook.ts:584` (`recordPaymentInXero(mapInvoiceToLedgerPayment(invoice, tier, year))`) and spec 008 design diagram. This design moves that hook into the shared handler so it consumes neutral `PaymentEvent` instead of a Stripe `Invoice` — one Xero adapter then serves both providers. To keep that possible, `PaymentEvent` carries what a ledger entry needs: `provider`, gross amount + currency, `providerRef`, paid-at timestamp, payer email/name, tier, membership year, and fee when provider reports it (optional). Xero clearing account will be per provider (spec 016's concern). Not building Xero here.

**Specs.** New `spec/017-payment-provider-abstraction/` (016 reserved for Xero adapter per `stripe-webhook.ts:584`) via `/spec:new`. Amend REQ-OV-014 ("Stripe is the sole payment provider"). Specs 007/008 stay as Stripe adapter specs, cross-referenced.

**Docs.** `docs/runbooks/airwallex-first-products.md` (sandbox account, Billing enablement, products/prices, dashboard webhook registration — no API for it, tunnel for local dev), `docs/CUSTOMIZE.md` provider section, `.env.example`, `docs/DEPLOY.md`, README stack line, CLAUDE.md stack line.

## Left to builder

Exact file split inside `src/lib/payments/`; Option C mechanism on Airwallex (after spike); whether `get-prices.ts` survives as route; test fixture shapes for Airwallex payloads (capture from sandbox).

## Order of work

1. Spike (throwaway): Airwallex sandbox — Billing Checkout + subscription with anchor start; capture webhook payloads.
2. Spec 017 requirements → design → tasks via `/spec:*`; commit this design as `docs/superpowers/specs/2026-10-27-airwallex-provider-design.md`.
3. Extract seam + Stripe adapter; all existing tests green, no behaviour change (one PR).
4. Sheet header migration + health `payment` key + worker (one PR).
5. Airwallex adapter + webhook route + docs (one PR).

## Verification

- `npm test` (Vitest) green after each step; existing `vi.mock("stripe")` tests move to adapter level; new contract test suite runs same scenarios against both adapters with mocked HTTP.
- Airwallex signature verify tested with captured sandbox payload + tampered body.
- `npm run build` + typecheck.
- Manual E2E on Airwallex sandbox through tunnel: associate signup, professional fee, both renewal tiers, test card `4035 5010 0000 0008`; confirm sheet rows, review Doc, emails; decline card `4012 0003 0000 1003` @ 80.59.
- Stripe regression: `e2e/` Playwright with `CHECKOUT_DRY_RUN=true`, plus `stripe listen` run of one Option C signup.
- `/api/health` with each provider; worker alert fires when credentials wrong.
