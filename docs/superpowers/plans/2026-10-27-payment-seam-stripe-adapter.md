# Payment Provider Seam + Stripe Adapter Implementation Plan (plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every Stripe call behind a provider-neutral `PaymentProvider` interface in `src/lib/payments/`, with **zero observable behaviour change** for Stripe deployments.

**Architecture:** Routes and the webhook domain logic talk only to `getPaymentProvider()`. `src/lib/payments/stripe/` is the only code importing `stripe`. Webhook = thin route → `provider.parseWebhook()` → neutral `PaymentEvent` → shared `handlePaymentEvent()`. Characterization tests written *before* the refactor (mocking the `stripe` SDK) are the regression net and must pass unchanged after it.

**Tech Stack:** Astro SSR, TypeScript, Vitest, `stripe` ^22.3.2 (pinned apiVersion `"2026-06-24.dahlia"`).

**Spec:** `docs/superpowers/specs/2026-10-27-airwallex-provider-design.md` (design). Plans 2 (sheet header migration + health `payment` key + worker) and 3 (Airwallex adapter, after sandbox spike) follow separately.

## Execution: zit (not plain git branches)

This repo uses zit (`zit status`). Its current state is `ed08fc7` (= `main` + `fix/basic-application-checkout-status`), so this work builds on the webhook fix.

- Replace every `git checkout -b` / `git commit` step in this plan with zit: per task, `zit materialise --intent "017 Task N: <title>" --agent claude-sonnet` → work in the printed workspace path → `zit record --summary "<the task's commit message>"` → `zit check <change>` → `zit accept <change>`. Next task materialises from the new current.
- Before Task 1: add `zit.toml` with checks `npm test` and `npm run check` (run `zit doctor` to confirm it parses), so `zit check` produces real evidence. Accept that as its own change.
- End: `zit export --branch feat/017-payment-seam --pr --base main`. The webhook fix is already in `main` as squash commit `1530894` (PR #79), but zit's base stays at its pre-squash twin `ed08fc7` (decided: leave it). The PR will show `ed08fc7` as one redundant commit with the same content as #79 — say so in the PR body.

## Global Constraints

- No behaviour change for Stripe: same Stripe API params, same idempotency keys, same metadata keys/values, same response JSON, same HTTP status codes and error messages — except the two deliberate changes listed in Task 6.
- Only files under `src/lib/payments/stripe/` may `import Stripe from "stripe"` (tests excepted). Check: `grep -rln 'from "stripe"' src --include=*.ts | grep -v '\.test\.ts' | grep -v 'src/lib/payments/stripe/'` prints nothing.
- Stripe `apiVersion` literal `"2026-06-24.dahlia"` appears in exactly one source file: `src/lib/payments/stripe/client.ts`.
- Out of scope here (later plans): sheet header renames, health `payment` key, `CURRENCY` casing, Airwallex code, `PAYMENT_PROVIDER=airwallex` working, `bin/` scripts.
- Do not fix the known pre-existing bugs (dead `invoice.metadata.flow` filter in failed-payment handling; `bin/setup-stripe-test.sh` subscribing to `invoice.paid`). Preserve them; they get separate issues.
- Money stays integer minor units; `currency` strings pass through exactly as Stripe returns them (lower-case).
- Commit messages reference REQ-IDs from spec 017 (Task 0), e.g. `refactor(017): REQ-PP-003 move checkout routes onto provider`.

## Review Focus

1. **Prorated amount changes week to week** — idempotency key must still embed the amount (`checkout:${plan}:${email}:${firstTermAmount}`, `upload-complete:${id}:${firstTermAmount}`), or a returning visitor hits a Stripe idempotency conflict. Pinned by Task 1 tests.
2. **Returning member (prior subscription) pays full annual price, existing customer reused** — pinned by Task 1 + Task 5 tests.
3. **Stripe retries the same renewal invoice** — no second Renewals row (dedupe via `getRenewalByStripeRef`). Pinned in Task 7 handler test.
4. **Missing `STRIPE_SECRET_KEY` at request time** — route returns its existing 500 message, module import does not throw. Pinned in Task 1 tests (one per route).
5. **Success URL placeholder** — `{CHECKOUT_REF}` must reach Stripe as `{CHECKOUT_SESSION_ID}` so success pages still get `?session_id=cs_…`. Pinned in Task 5 test.

---

### Task 0: Branch + spec 017 skeleton

**Files:**
- Create: `spec/017-payment-provider-abstraction/{requirements,design,tasks}.md` (via `/spec:new payment-provider-abstraction`; templates in `spec/_templates/`)
- Add: `docs/superpowers/specs/2026-10-27-airwallex-provider-design.md` (already written, uncommitted)

- [ ] **Step 1:** `git checkout -b feat/017-payment-seam`
- [ ] **Step 2:** Run `/spec:new payment-provider-abstraction`. In `requirements.md` define (prefix `REQ-PP`):
  - REQ-PP-001 provider selected by `PAYMENT_PROVIDER` (`stripe` default); unknown value is an error.
  - REQ-PP-002 provider-neutral `PaymentProvider` interface; routes and side-effect modules never import a provider SDK.
  - REQ-PP-003 Stripe adapter is behaviour-identical to pre-017 code.
  - REQ-PP-004 webhook domain logic consumes neutral `PaymentEvent`s (carries fields a future Xero ledger entry needs: provider, gross amount, currency, provider ref, paid-at, payer).
  - REQ-PP-005 single Stripe client factory with one pinned apiVersion.
  - REQ-PP-006 health check probes the active provider.
  - REQ-PP-007..010 reserved for plans 2–3 (sheet migration, health key, Airwallex adapter, new-deployment guard) — list as "planned".
  `design.md`: link the design doc. `tasks.md`: link this plan. Mark requirements approved (`/spec:approve requirements`).
- [ ] **Step 3: Commit**
```bash
git add spec/017-payment-provider-abstraction docs/superpowers/specs/2026-10-27-airwallex-provider-design.md docs/superpowers/plans/2026-10-27-payment-seam-stripe-adapter.md
git commit -m "docs(017): payment provider abstraction spec + design"
```

---

### Task 1: Characterization tests for untested Stripe routes

Lock current behaviour before touching it. These tests mock **only** the `stripe` SDK plus Sheets/logger/Sentry — never `stripe-checkout`/`stripe-products` — so they survive the refactor unchanged. Use one price fixture per file (the adapter will add a 5-min price cache in Task 4).

**Files:**
- Create: `src/pages/api/create-checkout-session.test.ts`, `src/pages/api/advanced/upload-complete.test.ts`, `src/pages/api/session-info.test.ts`, `src/pages/api/get-prices.test.ts`
- Pattern to copy: `vi.mock("stripe", …)` constructor mock in `src/pages/api/stripe-webhook.test.ts:82-116`; route invocation style in `src/pages/api/renew/checkout/[tier].test.ts`.

**Interfaces:** none produced.

- [ ] **Step 1: Write tests.** Freeze time with `vi.setSystemTime(new Date("2026-01-15T00:00:00Z"))`; env `STRIPE_SECRET_KEY=sk_test`, `STRIPE_PRICE_1=price_basic`, `STRIPE_PRICE_2=price_adv`, `PUBLIC_APP_URL=https://app.test`, price mock `{ id, active: true, currency: "usd", unit_amount: 10000 }`.
  - `create-checkout-session`:
    - `new customer gets prorated amount and option_c metadata` — `checkout.sessions.create` called once with `mode: "payment"`, `line_items[0].price_data.unit_amount === calcFirstTermAmount(10000)` (hardcode `4560` — 166 days ÷ 7 ÷ 52 × 10000, rounded; confirm against current code on first run. Do not import the helper: Task 2 moves it), `customer_creation: "always"`, `customer_email`, `metadata.flow === "option_c"`, `metadata.recurring_price_id === "price_basic"`, `success_url === "https://app.test/associate-membership?session_id={CHECKOUT_SESSION_ID}"`, `cancel_url === "https://app.test/cancel"`, `payment_intent_data.setup_future_usage === "off_session"`, options `{ idempotencyKey: "checkout:basic:a@b.test:<amount>" }`; response JSON `{ id, url, plan, firstTermAmount, annualAmount: 10000, proratedFirstTerm: true, … }`.
    - `returning customer with prior subscription pays full annual and reuses customer` — `customers.list` → `[{id:"cus_1"}]`, `subscriptions.list` → `[{}]`; asserts `unit_amount === 10000`, `params.customer === "cus_1"`, no `customer_creation`.
    - `advanced plan success_url is /success` .
    - `basic apply source appends Basic Applications row and adds basic_application_id metadata` (mock `../../lib/google-sheets` `appendBasicApplication`; minimal valid associate payload — copy from `src/lib/forms/schemas/applyBasic*.test.ts` fixtures).
    - `dry run returns dryRun:true and creates no session` (`CHECKOUT_DRY_RUN=true`, `STRIPE_WEBHOOK_SECRET=whsec`); `message` contains `"Stripe keys and price configuration validated"`.
    - `missing STRIPE_SECRET_KEY → 500 "Server is missing STRIPE_SECRET_KEY."`
    - `non-usd price → 500 "Recurring price must be a fixed USD amount."`
    - `Stripe error → 500 with Stripe error message` (throw an object passing `instanceof Stripe.errors.StripeError` — expose `errors.StripeError` class on the mock).
  - `advanced/upload-complete`: mock `../../../lib/upload-sheet` (`getApplicantByToken` → `{ id:"app_1", email, firstName, lastName, paid:"" }`, `validateCompletion` → true).
    - `creates prorated session with applicant metadata` — `metadata.applicant_id === "app_1"`, `resume_token`, `plan: "advanced"`, `recurring_price_id: "price_adv"`, `success_url === "https://app.test/advanced/success-upload?session_id={CHECKOUT_SESSION_ID}"`, `cancel_url` ends `?token=<token>`, `line_items[0].price_data.product_data.name === "Professional Membership"`, idempotencyKey `upload-complete:app_1:<amount>`.
    - `already paid → 400 ALREADY_COMPLETED`; `incomplete → 400 INCOMPLETE`; `missing STRIPE_PRICE_2 → 500 MISSING_CONFIG "Server is missing STRIPE_PRICE_2."`; `StripeConnectionError → 500 retryable:true`.
  - `session-info`: `returns plan/name/email/amount/customerId from session`; `unknown session → 404 "Session not found."`; `missing key → 500`.
  - `get-prices`: `returns {basic:{amount,formatted}, advanced:{…}}`; `skips plan whose price retrieve throws`; `missing key → 500`.
- [ ] **Step 2:** `npx vitest run src/pages/api/create-checkout-session.test.ts src/pages/api/advanced/upload-complete.test.ts src/pages/api/session-info.test.ts src/pages/api/get-prices.test.ts` — Expected: all PASS against current code (these are characterization tests; a failure means the test is wrong, not the code).
- [ ] **Step 3: Commit** `test(017): REQ-PP-003 characterize Stripe checkout routes before refactor`

---

### Task 2: Extract provider-neutral membership terms

Pure move; no logic change.

**Files:**
- Create: `src/lib/membership-terms.ts` ← move from `src/lib/stripe-checkout.ts`: `MembershipPlan`, `isPromoWindow`, `getNextRenewalAnchorDate`, `getNextRenewalAnchorEpoch`, `ProrationUnit`, `calcFirstTermAmount`, `getSiteBaseUrl`, `getPlanDisplayName`, `formatAmount`, `isCheckoutDryRunEnabled`.
- Rename: `src/lib/stripe-checkout.test.ts` → `src/lib/membership-terms.test.ts` (drop any `getPriceForPlan`/`isStripeRetryableError` cases into a note for Task 4).
- Modify: `src/lib/stripe-checkout.ts` keeps only `getPriceForPlan`, `isStripeRetryableError` (deleted in Task 6).
- Modify imports: `src/pages/api/advanced/apply.ts`, `src/pages/api/advanced/resend-link.ts`, and the `vi.mock("../../../lib/stripe-checkout")` in `apply.test.ts:53`, `resend-link.test.ts:38` → `membership-terms`. Other importers of moved names (`create-checkout-session.ts`, `upload-complete.ts`, `renew/checkout/[tier].ts`, `get-prices.ts`, `[tier].test.ts:28`) import moved names from `membership-terms`.

- [ ] **Step 1:** Move code + update imports.
- [ ] **Step 2:** `npm test` — Expected: all PASS (including Task 1 tests).
- [ ] **Step 3: Commit** `refactor(017): REQ-PP-002 split neutral membership terms from stripe-checkout`

---

### Task 3: Payment types + provider registry

**Files:**
- Create: `src/lib/payments/types.ts`, `src/lib/payments/index.ts`, `src/lib/payments/index.test.ts`
- Modify: `src/env.d.ts` (add `readonly PAYMENT_PROVIDER?: string;`), `.env.example` (document `PAYMENT_PROVIDER=stripe`)

**Interfaces — Produces** (`types.ts`, exact):
```ts
export type ProviderId = "stripe" | "airwallex";
export type PriceKind = "application" | "renewal";
export interface PriceInfo { priceRef: string; currency: string; unitAmount: number }
export interface ReturningCustomer { customerRef: string; hadSubscription: boolean }
export type CheckoutLineItem =
  | { kind: "price"; priceRef: string }
  | { kind: "amount"; amount: number; currency: string; name: string; description?: string };
export interface CheckoutInput {
  mode: "one_time" | "first_term_then_annual";
  lineItem: CheckoutLineItem;
  customerEmail: string;
  customerRef?: string;            // reuse existing customer; else provider creates one
  clientReference: string;
  metadata: Record<string, string>;
  successUrl: string;              // may contain CHECKOUT_REF_PLACEHOLDER
  cancelUrl: string;
  submitMessage?: string;
  idempotencyKey: string;
}
export interface CheckoutResult { checkoutRef: string; redirectUrl: string }
export interface CheckoutSummary {
  checkoutRef: string; metadata: Record<string, string>;
  customerEmail: string | null; amountTotal: number | null; customerRef: string | null;
}
export interface EnsureSubscriptionInput {
  checkoutRef: string; customerRef: string; paymentRef: string | null;
  priceRef: string; anchorEpoch: number; plan: string;
}
export type PaymentEvent =
  | { type: "checkout_completed"; provider: ProviderId; checkoutRef: string; paymentRef: string | null;
      customerRef: string | null; customerEmail: string | null; amountTotal: number; paidAt: string;
      metadata: Record<string, string> }
  | { type: "renewal_charged"; provider: ProviderId; providerRef: string; customerRef: string;
      subscriptionRef: string; amount: number; currency: string; customerName: string;
      customerEmail: string; periodStartEpoch: number; paidAt: string;
      subscriptionMetadata: Record<string, string> }
  | { type: "renewal_failed"; provider: ProviderId; providerRef: string; customerRef: string;
      metadata: Record<string, string> }
  | { type: "subscription_updated" | "subscription_cancelled"; provider: ProviderId;
      subscriptionRef: string; customerRef: string; status: string; metadata: Record<string, string> };
export interface ParsedWebhook {
  eventType: string; apiVersion: string; event: PaymentEvent | null; ignoredReason?: string;
}
export interface HealthStatus { status: "connected" | "disconnected" | "not_configured"; error?: string }
export interface PaymentProvider {
  readonly id: ProviderId;
  missingConfig(scope: "api" | "webhook"): string[];          // env var names that are unset
  resolvePrice(tierSlug: string, kind: PriceKind): Promise<PriceInfo>;
  findReturningCustomer(email: string): Promise<ReturningCustomer | null>;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  getCheckout(checkoutRef: string): Promise<CheckoutSummary>;
  ensureSubscription(input: EnsureSubscriptionInput): Promise<{ subscriptionRef: string }>;
  parseWebhook(rawBody: string, headers: Headers): Promise<ParsedWebhook>;
  healthCheck(): Promise<HealthStatus>;
  isRetryableError(err: unknown): boolean;
  userFacingError(err: unknown): string | null;               // provider's own message, else null
}
```
`index.ts` exports: `getPaymentProvider(): PaymentProvider`, `CHECKOUT_REF_PLACEHOLDER = "{CHECKOUT_REF}"`, error classes `PaymentConfigError`, `WebhookConfigError`, `WebhookSignatureError` (all `extends Error`, set `name`), re-export types.

- [ ] **Step 1: Failing tests** (`index.test.ts`):
  - `defaults to stripe when PAYMENT_PROVIDER unset` → `getPaymentProvider().id === "stripe"`.
  - `accepts " Stripe " (trim, case-insensitive)`.
  - `airwallex not available yet` → throws `PaymentConfigError` with message `PAYMENT_PROVIDER=airwallex is not available in this build`.
  - `unknown value throws` → `PaymentConfigError` message `Unknown PAYMENT_PROVIDER "paypal" (expected stripe|airwallex)`.
- [ ] **Step 2:** Run `npx vitest run src/lib/payments/index.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3:** Implement. Registry returns the Stripe adapter singleton from Task 4/5; until Task 4 lands, return a stub object typed `PaymentProvider` whose methods throw `not implemented` — or do Tasks 3–5 before running Step 4. Memoize by normalized env value (re-read env each call so tests can change it).
- [ ] **Step 4:** Run tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(017): REQ-PP-001 REQ-PP-002 payment provider types and registry`

---

### Task 4: Stripe adapter — client, prices, customers, health, errors

**Files:**
- Create: `src/lib/payments/stripe/client.ts`, `src/lib/payments/stripe/prices.ts`, `src/lib/payments/stripe/index.ts` (adapter object, grows in Task 5), tests `src/lib/payments/stripe/prices.test.ts`, `src/lib/payments/stripe/adapter.test.ts`
- Move: logic of `src/lib/stripe-products.ts` → `prices.ts`; port its tests from `src/lib/stripe-products.test.ts`.

**Interfaces — Produces:**
- `client.ts`: `export const STRIPE_API_VERSION = "2026-06-24.dahlia" as Stripe.LatestApiVersion;` `export function getStripeClient(): Stripe` — throws `PaymentConfigError("MISSING_CONFIG: STRIPE_SECRET_KEY")` if unset; caches one instance per secret-key value. `export function resetStripeClientForTests(): void`.
- `prices.ts`: `export async function resolveStripePrice(tierSlug: string, kind: PriceKind): Promise<PriceInfo>`; env var from `getTier(tierSlug).priceEnvVar` (application) / `.renewalPriceEnvVar` (renewal). Keeps today's error prefixes and messages: `MISSING_CONFIG: unknown tier <slug>`, `MISSING_CONFIG: <ENV> not set`, `PRICE_RETRIEVE_FAILED: …`, `PRICE_INACTIVE: …`, `INVALID_CURRENCY: …` (vs `CURRENCY` from `src/lib/config.ts`), `INVALID_UNIT_AMOUNT: …`. 5-min cache keyed `${kind}:${tierSlug}`. `export function invalidateStripePriceCache(): void`. The `LookupKey` resolver is dropped.
- Adapter methods in this task: `missingConfig` (`api` → `["STRIPE_SECRET_KEY"]` if unset; `webhook` → adds `"STRIPE_WEBHOOK_SECRET"` if unset), `resolvePrice` (→ `resolveStripePrice`), `findReturningCustomer` (logic of `getExistingCustomerInfo`, `create-checkout-session.ts:49-70`; returns `null` when no customer), `healthCheck` (`products.list({limit:1})`; `not_configured` when key unset), `isRetryableError` (`StripeConnectionError` | `StripeAPIError` by `name`), `userFacingError` (`err instanceof Stripe.errors.StripeError ? err.message : null`).

- [ ] **Step 1: Failing tests:**
  - `prices.test.ts`: port every case of `stripe-products.test.ts` to `resolveStripePrice(slug, "renewal")`; add `application kind reads STRIPE_PRICE_1 for basic`, `cache is per kind (application and renewal for same tier resolve different ids)`.
  - `adapter.test.ts`: `client created with pinned apiVersion` (assert ctor args `("sk_test", { apiVersion: "2026-06-24.dahlia" })`); `findReturningCustomer → null when customers.list empty`; `→ {customerRef:"cus_1", hadSubscription:true}` / `false` when subs empty, and `subscriptions.list` called with `{ customer: "cus_1", status: "all", limit: 1 }`; `missingConfig("webhook")` lists both names when unset; `healthCheck` connected / disconnected(error message) / not_configured; `isRetryableError` true for `{name:"StripeConnectionError"}`.
- [ ] **Step 2:** Run — Expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/lib/payments` — Expected PASS.
- [ ] **Step 5: Commit** `feat(017): REQ-PP-003 REQ-PP-005 Stripe adapter client, prices, customers, health`

---

### Task 5: Stripe adapter — checkout, subscription, webhook parsing

**Files:**
- Modify: `src/lib/payments/stripe/index.ts`; create `src/lib/payments/stripe/webhook.ts`; tests `src/lib/payments/stripe/checkout.test.ts`, `src/lib/payments/stripe/webhook.test.ts`

**Interfaces — Consumes:** Task 3 types, Task 4 `getStripeClient`.
**Produces:** remaining adapter methods.

Mapping rules (exact):
- `createCheckout` → `checkout.sessions.create(params, { idempotencyKey })` with: `mode: "payment"` for **both** modes (Stripe Option C is a payment-mode session; subscription made later by `ensureSubscription`); `success_url` = `successUrl.replace(CHECKOUT_REF_PLACEHOLDER, "{CHECKOUT_SESSION_ID}")`; `cancel_url`; `line_items: [{ quantity: 1, price: priceRef }]` for `kind:"price"`, else `[{ quantity: 1, price_data: { currency, unit_amount: amount, product_data: { name, description } } }]`; `metadata`; `client_reference_id: clientReference`; `custom_text: { submit: { message } }` only when `submitMessage` set; `payment_intent_data: { setup_future_usage: "off_session", receipt_email: customerEmail }`; `customerRef ? { customer } : { customer_creation: "always", customer_email }`. Returns `{ checkoutRef: session.id, redirectUrl: session.url }`.
- `getCheckout(ref)` → `checkout.sessions.retrieve(ref, { expand: ["line_items"] })` mapped to `CheckoutSummary` (`customerEmail: session.customer_email`, `amountTotal: session.amount_total`, customer string or `.id`). Errors propagate.
- `ensureSubscription` → body of `stripe-webhook.ts:152-233` minus sheet writes: retrieve PaymentIntent for payment method (warn-and-continue on failure), attach + set default, `subscriptions.create({ customer, items:[{price: priceRef}], trial_end: anchorEpoch, metadata:{ flow:"option_c", plan, checkout_session_id: checkoutRef }, expand:["default_payment_method"], default_payment_method? }, { idempotencyKey: \`option_c_sub_${checkoutRef}\` })`. Logs keep the same event names (`checkout_completed.payment_intent_retrieve_failed`, `…payment_method_attach_failed`); pass a logger in via optional second param `log?: ReturnType<typeof logger.child>`.
- `parseWebhook(rawBody, headers)`: header `stripe-signature` missing → throw `WebhookConfigError`; `webhooks.constructEvent` throws → `WebhookSignatureError`. Then by `event.type`:
  - `checkout.session.completed`: `session.mode !== "payment"` → `event:null, ignoredReason:"non_payment_mode"`; else `checkout_completed` (`paymentRef` = `session.payment_intent` if string, `customerRef` = `session.customer` if string, `amountTotal: session.amount_total ?? 0`, `paidAt: new Date().toISOString()`, `metadata: session.metadata ?? {}`).
  - `invoice.payment_succeeded`: the filters from `stripe-webhook.ts:438-473` move here → `null` with `ignoredReason` `"billing_reason:<x>"`, `"zero_amount"`, `"missing_ids"`; subscription-metadata fallback `subscriptions.retrieve` stays here. Emits `renewal_charged` with `providerRef: invoice.id`, `amount: invoice.amount_paid`, `currency: invoice.currency ?? ""`, `customerName: invoice.customer_name ?? ""`, `customerEmail: invoice.customer_email ?? ""`, `periodStartEpoch: invoice.lines?.data?.[0]?.period?.start ?? invoice.created`, `subscriptionMetadata`. The `flow` check is NOT done here.
  - `invoice.payment_failed`: `customer` not string → `null`; else `renewal_failed` with `metadata: invoice.metadata ?? {}` (preserves today's dead filter — see Global Constraints).
  - `customer.subscription.updated`: `status` `canceled`|`unpaid` → `subscription_cancelled`, else `subscription_updated`. `customer.subscription.deleted` → `subscription_cancelled`. Customer not string → `null`.
  - anything else → `event:null, ignoredReason:"unhandled_type"`.
  - `apiVersion: event.api_version ?? "unknown"`.

- [ ] **Step 1: Failing tests:**
  - `checkout.test.ts`: `amount line item maps to price_data`; `price line item maps to price`; `success url placeholder becomes {CHECKOUT_SESSION_ID}` (input `https://a/x?session_id={CHECKOUT_REF}` → `https://a/x?session_id={CHECKOUT_SESSION_ID}`); `existing customerRef sets customer and omits customer_creation`; `no submitMessage → no custom_text`; `idempotencyKey forwarded`; `ensureSubscription creates trialing subscription with idempotency option_c_sub_<ref> and attaches payment method`; `ensureSubscription still creates subscription when PaymentIntent retrieve fails` (no `default_payment_method`).
  - `webhook.test.ts`: one test per mapping bullet above, including `missing header → WebhookConfigError`, `bad signature → WebhookSignatureError`, `subscription_create invoice ignored`, `$0 cycle invoice ignored`, `flow metadata from subscription_details snapshot`, `falls back to subscriptions.retrieve when snapshot lacks flow`.
- [ ] **Step 2:** Run — Expected FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run src/lib/payments` — PASS.
- [ ] **Step 5: Commit** `feat(017): REQ-PP-003 Stripe adapter checkout, subscription, webhook parsing`

---

### Task 6: Move checkout + session routes onto the provider

**Files:**
- Modify: `src/pages/api/create-checkout-session.ts`, `src/pages/api/advanced/upload-complete.ts`, `src/pages/api/renew/checkout/[tier].ts`, `src/pages/api/session-info.ts`, `src/pages/api/renew/session-info.ts`, `src/pages/api/get-prices.ts`
- Modify tests: `src/pages/api/renew/checkout/[tier].test.ts` (replace `stripe-products`/`stripe-checkout` mocks with a mock of `../../../../lib/payments` returning a fake provider; keep every existing case and assertion on outputs), `src/pages/api/renew/session-info.test.ts` only if needed (it mocks `stripe`, should pass as is).
- Delete: `src/lib/stripe-checkout.ts`, `src/lib/stripe-products.ts`, `src/lib/stripe-products.test.ts`.

**Interfaces — Consumes:** `getPaymentProvider`, `CHECKOUT_REF_PLACEHOLDER` (Task 3); membership-terms (Task 2).

Route rules:
- Each route: `const provider = getPaymentProvider();` then `const missing = provider.missingConfig("api")`; if non-empty, return the route's existing 500 body with `Server is missing ${missing[0]}.` (session-info keeps `"Server misconfiguration."`; renew/session-info keeps its `MISSING_CONFIG` behaviour).
- Dry-run checks `provider.missingConfig("webhook")` for the `STRIPE_WEBHOOK_SECRET` message, same text as today.
- Prices: `provider.resolvePrice(plan, "application")`. Map errors: message starts `MISSING_CONFIG` → existing missing-price 500 (`Server is missing recurring price ID for plan '<plan>'.` / `Server is missing STRIPE_PRICE_2.` code `MISSING_CONFIG`); `INVALID_CURRENCY`/`INVALID_UNIT_AMOUNT` → `Recurring price must be a fixed ${CURRENCY.toUpperCase()} amount.`; others → route's generic checkout error. `[tier].ts` keeps its MISSING_CONFIG / PRICE_INACTIVE / CHECKOUT_ERROR mapping using `resolvePrice(tierSlug, "renewal")`.
- Success URLs use `?session_id=${CHECKOUT_REF_PLACEHOLDER}`.
- Error responses: `provider.userFacingError(err) ?? "Unable to create checkout session."`; retryable via `provider.isRetryableError(err)`.
- Response JSON keeps `id` (= `checkoutRef`) and `url` (= `redirectUrl`).
- `get-prices.ts` loops `listTiers()` slugs `basic`,`advanced` via `resolvePrice(slug, "application")`, skipping (and logging `get_prices.retrieve_failed`) on error.

**Deliberate behaviour changes (only these two):**
1. `upload-complete.ts` reads its price via tier config (`getTier("advanced").priceEnvVar`, still `STRIPE_PRICE_2`) and uses `getTier("advanced").label` as product name instead of hardcoded `"Professional Membership"`. Update that one assertion in `upload-complete.test.ts` to `getTier("advanced").label`.
2. Application checkout now rejects an **inactive** Stripe price (via the shared resolver's `PRICE_INACTIVE` check) instead of failing later at subscription creation. Add test `inactive price → 500` to `create-checkout-session.test.ts`.

- [ ] **Step 1:** Update `[tier].test.ts` mocks; add the two tests from "deliberate changes". Run `npm test` — Expected: the new/updated tests FAIL, everything else PASS.
- [ ] **Step 2:** Rewrite the six routes; delete the old modules.
- [ ] **Step 3:** `npm test` — Expected: ALL PASS, Task 1 tests unmodified apart from change 1.
- [ ] **Step 4:** Constraint checks: the `grep` from Global Constraints prints nothing for these routes; `grep -rn "2026-06-24.dahlia" src | grep -v test` shows only `client.ts`.
- [ ] **Step 5: Commit** `refactor(017): REQ-PP-002 REQ-PP-003 checkout and session routes use payment provider`

---

### Task 7: Shared payment-event handler + thin Stripe webhook route

**Files:**
- Create: `src/lib/payments/handle-payment-event.ts`, `src/lib/payments/handle-payment-event.test.ts`
- Modify: `src/pages/api/stripe-webhook.ts` (route only)
- Keep unchanged: `src/pages/api/stripe-webhook.test.ts` (integration net — must pass without edits)

**Interfaces — Produces:** `export async function handlePaymentEvent(event: PaymentEvent, provider: PaymentProvider, log: ReturnType<typeof logger.child>): Promise<void>`.

Moves (logic verbatim, inputs now from the event):
- `checkout_completed`: renewal branch (`stripe-webhook.ts:43-114`, `session.id` → `event.checkoutRef`, `session.customer` → `event.customerRef ?? ""`); Option C branch (`:117-412`) with the subscription block replaced by `provider.ensureSubscription({ checkoutRef, customerRef, paymentRef, priceRef: metadata.recurring_price_id, anchorEpoch: parseInt(metadata.next_july1_epoch ?? "0", 10), plan }, log)` wrapped in the same Sentry capture + rethrow; `session.amount_total` → `event.amountTotal`; `session.customer_email` → `event.customerEmail ?? ""`.
- `renewal_charged`: `:474-585` — `flow !== "option_c"` skip, `getRenewalByStripeRef(providerRef)` dedupe, year from `periodStartEpoch`, `stripeSession: providerRef`, append-then-fire-and-forget. Move the Xero comment here, reworded: `// Spec 016 hook: recordPaymentInXero(mapEventToLedgerPayment(event, tier, year)) — F&F.`
- `renewal_failed`: `metadata.flow !== "option_c"` → return; `setPaymentFailed(customerRef, providerRef)`.
- `subscription_cancelled` / `subscription_updated`: `metadata.flow` check; cancelled → `setCancelled`, log `subscription.updated.cancelled` when `status` is `canceled`/`unpaid` else `subscription.deleted`; updated → log only.

Route: `provider.id !== "stripe"` → 404 `Not found.`; `missingConfig("webhook")` non-empty → 400 `Missing webhook config.`; `parseWebhook(await request.text(), request.headers)`: `WebhookConfigError` → 400 `Missing webhook config.`, `WebhookSignatureError` → 400 `Invalid webhook signature.`; `event === null` → log `webhook.ignored` with `ignoredReason`, return 200 `{received:true, eventId}`; else `handlePaymentEvent` inside today's try/catch → 500 `Webhook processing failed.`. Log child fields unchanged (`eventId`, `eventType`, `apiVersion`).

- [ ] **Step 1: Failing tests** (`handle-payment-event.test.ts`, fake provider object, mock sheet/email/doc modules as in `stripe-webhook.test.ts:27-80`):
  - `renewal checkout marks renewal paid with checkoutRef`; `already-paid renewal skipped`.
  - `option_c checkout calls ensureSubscription then setAwaitingSubscription and setActive`; `skips ensureSubscription when membership already has subscriptionId`; `ensureSubscription failure rethrows`.
  - `renewal_charged appends Renewals row once; second identical event (getRenewalByStripeRef returns row) appends nothing`.
  - `renewal_charged with flow != option_c ignored`.
  - `renewal_failed only acts on option_c metadata`.
  - `subscription_cancelled calls setCancelled`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement handler + route.
- [ ] **Step 4:** `npm test` — Expected: ALL PASS, `stripe-webhook.test.ts` untouched (`git diff --stat src/pages/api/stripe-webhook.test.ts` empty).
- [ ] **Step 5: Commit** `refactor(017): REQ-PP-004 neutral payment events and shared webhook handler`

---

### Task 8: Health check via provider

**Files:** Modify `src/pages/api/health.ts`, `src/pages/api/health.test.ts`.

- `checkStripe()` → `getPaymentProvider().healthCheck()`; renewal prices → `provider.resolvePrice(tier.slug, "renewal")`. **Response JSON unchanged** (`stripe`, `email`, `renewal_prices`, `errors.stripe`, `errors["renewal_prices.<slug>"]`) — key rename is plan 2. Log event names unchanged.
- Test: replace `stripe-products` mock with a mock of `../../lib/payments` (`healthCheck`, `resolvePrice`); every existing assertion on response bodies kept.

- [ ] **Step 1:** Update test mocks; run — FAIL. **Step 2:** Implement. **Step 3:** `npm test` — PASS.
- [ ] **Step 4: Commit** `refactor(017): REQ-PP-006 health check probes active payment provider`

---

### Task 9: Final verification + docs touch-ups

**Files:** `docs/CUSTOMIZE.md` (one paragraph: payment code lives in `src/lib/payments/`; `PAYMENT_PROVIDER` defaults to `stripe`; Airwallex coming in spec 017), `spec/017-…/tasks.md` (tick done), memory file `~/.claude/projects/-Users-thomasb-jimumember/memory/stripe-apiversion-contract.md` (now one site: `src/lib/payments/stripe/client.ts`).

- [ ] **Step 1:** `npm test` — all PASS.
- [ ] **Step 2:** `npm run check` — 0 errors.
- [ ] **Step 3:** `npm run build` — succeeds.
- [ ] **Step 4:** Global-constraint greps (SDK import, apiVersion literal) — clean.
- [ ] **Step 5:** `npm run test:e2e` (Playwright, `CHECKOUT_DRY_RUN=true`) — PASS.
- [ ] **Step 6:** Manual Stripe smoke (test mode): `stripe listen --forward-to localhost:4321/api/stripe-webhook`, run one associate signup with card `4242 4242 4242 4242`; confirm Checkout log row, Memberships row `active` with `sub_…`, review Doc, confirmation email.
- [ ] **Step 7: Commit** `docs(017): note payment provider seam`; open PR referencing REQ-PP-001..006.
