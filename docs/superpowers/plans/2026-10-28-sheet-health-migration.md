# Sheet / Health / Worker Migration Implementation Plan (plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make everything the app persists or reports provider-neutral — sheet header names, a `provider` column, the `/api/health` payload, the alert worker and the dry-run copy — so plan 3 can add Airwallex without another migration. Stripe deployments keep working with no manual step before or after deploy.

**Architecture:** Column letters never move (production contract). Header *text* in code changes (`stripe_session` → `payment_ref`); existing sheets keep their old header text because `ensureSheetWithHeaders` only checks cell A1 and the code reads by position. Two new trailing `provider` columns (Memberships J, Checkout Log J) are stamped from `PaymentEvent.provider`. `/api/health` gains `payment: { provider, status, error? }` and keeps the old `stripe` keys as aliases while the provider is Stripe; the Cloudflare worker reads `payment` first and falls back to `stripe`.

**Tech Stack:** Astro SSR, TypeScript, Vitest, Google Sheets helpers (`src/lib/google-sheets-helpers.ts`), Cloudflare Worker (`.run/health-alert-worker/`).

**Spec:** `docs/superpowers/specs/2026-10-27-airwallex-provider-design.md` (sections "Sheets (the migration)", "Health", "Dry run"); requirements REQ-PP-007 and REQ-PP-008 in `spec/017-payment-provider-abstraction/requirements.md`. Plan 1 (merged as PR #82): `docs/superpowers/plans/2026-10-27-payment-seam-stripe-adapter.md`.

## Execution: zit

Same workflow as plan 1. Zit's current state is `main` (`eeec1bc`, the squash of #82); `zit.toml` already declares `npm test` + `npm run check` checks and `npm ci` as prepare. Per task: `zit materialise --intent "017 plan2 Task N: <title>" --agent claude-sonnet --json` → work in the printed `path` (it already has `node_modules`; do not symlink one) → `zit record --summary "<commit message>" --dispose` → `zit check <change>` → `zit accept <change>`. Port code from the **zit workspace's** files, never from the main checkout (plan 1 lost the `checkout_status` fix once by copying a stale file). Task 0 (before Task 1): materialise a workspace, copy this plan file (currently untracked in the main checkout at `docs/superpowers/plans/2026-10-28-sheet-health-migration.md`) into it, record/check/accept as `docs(017): plan 2 (sheet/health/worker migration)`, then delete the untracked copy from the main checkout so later fast-forwards of `main` are not blocked. End: `zit export --branch feat/017-sheet-health-migration --pr --base main`, then ask the user before running it (it pushes and opens a PR).

## Global Constraints

- Column letters are production contracts and do not move: applicant sheet payment ref stays **AQ** (index 42), Renewals **L** (index 11), Memberships keeps **A–I** and gains **J**, Checkout Log keeps **A–I** and gains **J**.
- Header text in code becomes `payment_ref`; **never rewrite header cells of existing sheets automatically** (only the Memberships `provider` cell J1 is backfilled, Task 2). Existing deployments must keep working with their old `stripe_session` header text.
- Option **values** and everything the Stripe webhook/checkout routes send or return stay identical (plan 1 constraint). Only deliberate changes: provider stamping and the dry-run wording in Task 6.
- `/api/health` keeps its status codes (always 200) and, for the Stripe provider, keeps `stripe`, `errors.stripe` and `renewal_prices` exactly as today, additionally exposing `payment` and `errors.payment`.
- Only `src/lib/payments/stripe/` imports the Stripe SDK; the `apiVersion` literal stays in `client.ts` (verify with the greps from plan 1 at the end).
- Money stays integer minor units; no Airwallex code in this plan; `PAYMENT_PROVIDER=airwallex` is still rejected.
- Commit/zit summaries reference REQ-IDs: `refactor(017): REQ-PP-007 …`, `feat(017): REQ-PP-008 …`.

## Review Focus

1. **Legacy 9-column Memberships rows** (no J cell) must read as `provider === ""` without throwing; when a Stripe event touches such a row the existing columns are preserved and J is stamped `"stripe"`. (Task 2)
2. **Old worker against the new app**: a worker that only reads `body.stripe` must still see the same string for the Stripe provider. **New worker against an old app** (no `payment` key) must fall back to `stripe`. (Tasks 4, 5)
3. **Checkout Log row grows to 10 cells** but H (session/payment ref) and I (customer) must not shift. (Task 3)
4. **Invalid `PAYMENT_PROVIDER`** (e.g. `paypal`): `/api/health` stays 200, `status: "degraded"`, `payment.provider` echoes the configured value, no `stripe` alias claims the provider is Stripe. (Task 4)
5. **Brand-new sheets** created by the code get `payment_ref` / `provider` headers; **existing sheets with old headers** are never rewritten. (Tasks 1, 2)

---

### Task 1: Rename `stripe_session` → `payment_ref` in code (no behaviour change)

**Files:**
- Modify: `src/lib/renewal-sheet.ts` (`RenewalInput.stripeSession`/`RenewalRow.stripeSession` → `paymentRef`; headers constant line ~60 `"stripe_session"` → `"payment_ref"`; `getRenewalByStripeRef` → `getRenewalByPaymentRef`; comments at ~99, ~136, ~145)
- Modify: `src/lib/upload-sheet.ts` (`SHEET_HEADERS` entry `AQ` `"stripe_session"` → `"payment_ref"`; `stripeSessionId`/`stripeSession` fields and params → `paymentRef`; `markComplete(applicantId, paymentRef)`, `markPaid`-adjacent helper at ~788; row[42] reads unchanged)
- Modify: `src/lib/payments/handle-payment-event.ts` (call `getRenewalByPaymentRef`, pass `paymentRef:`; adjust the comment), `src/pages/api/renew/checkout/[tier].ts` (`paymentRef: ""`)
- Modify: `bin/setup-google-workspace.js` (Renewals header `stripe_session` → `payment_ref`; the Basic Applications entry named `stripe_session` → `payment_ref` too — note in the ledger that this header list already drifts from `ASSOCIATE_APPLICATIONS_HEADERS` in `src/lib/google-sheets.ts`; do not fix the drift here)
- Modify comments: `src/lib/forms/schemas/renewBasic.ts:17`, `renewAdvanced.ts:12`, `advancedApply.ts:20,240`
- Modify tests (mechanical renames only): `src/lib/renewal-sheet.test.ts`, `src/lib/upload-sheet.test.ts`, `src/lib/payments/handle-payment-event.test.ts`, `src/pages/api/stripe-webhook.test.ts` (rename `mockGetRenewalByStripeRef`/`stripeSession:` → payment-ref names; this file's *assertions about behaviour* must stay the same), `src/lib/forms/schemas/advancedApply.test.ts:138` (comment)

**Interfaces:**
- Produces: `RenewalInput.paymentRef: string`, `RenewalRow.paymentRef: string`, `getRenewalByPaymentRef(ref: string): Promise<RenewalRow | null>` (same semantics as `getRenewalByStripeRef`), `markComplete(applicantId: string, paymentRef: string): Promise<void>`, applicant row type field `paymentRef: string`. Tasks 2–3 and plan 3 call these names.

- [ ] **Step 1: Write failing tests.** In `renewal-sheet.test.ts`, extend "calls ensureSheetWithHeaders on first write to create Renewals tab": assert the headers array passed to the mocked `ensureSheetWithHeaders` has `headers[11] === "payment_ref"` and does not contain `"stripe_session"`. In `upload-sheet.test.ts`, add `applicant sheet headers put payment_ref at column AQ`: capture the headers passed to the mocked `ensureSheetWithHeaders` (via `createApplicantRow`) and assert `headers[42] === "payment_ref"` and that no header equals `"stripe_session"`. Rename the existing `getRenewalByStripeRef` usages in tests to `getRenewalByPaymentRef` and `stripeSession` → `paymentRef`.
- [ ] **Step 2:** `npx vitest run src/lib/renewal-sheet.test.ts src/lib/upload-sheet.test.ts` — Expected: FAIL (old names/headers).
- [ ] **Step 3:** Apply the renames listed under Files. Pure rename: no logic changes; positional reads (`row[11]`, `row[42]`) and write ranges stay.
- [ ] **Step 4:** `npm test` and `npm run check` — Expected: all PASS, 0 errors. `git diff --stat -- src/pages/api/stripe-webhook.test.ts` shows only renamed identifiers (review the diff by eye: no assertion about calls/args other than renamed names may change).
- [ ] **Step 5:** Verify: `grep -rn "stripe_session\|stripeSession\|getRenewalByStripeRef" src bin .run` prints nothing except the migration-compat note you add to `docs` later (so: nothing). Land via zit: `refactor(017): REQ-PP-007 rename stripe_session to payment_ref in code`.

---

### Task 2: Memberships `provider` column (J)

**Files:**
- Modify: `src/lib/memberships.ts`, `src/lib/payments/handle-payment-event.ts`, `bin/memberships-backfill.js`
- Test: `src/lib/memberships.test.ts`, `src/lib/payments/handle-payment-event.test.ts`, `src/pages/api/stripe-webhook.test.ts` (update call-argument assertions only)

**Interfaces:**
- Consumes: `PaymentEvent.provider: ProviderId` (plan 1, `src/lib/payments/types.ts`).
- Produces:
  - `MembershipRecord.provider: string` (`""` for legacy rows).
  - `setAwaitingSubscription(customerId, data /* now includes provider: string */, lastEvent?)`.
  - `setActive(customerId: string, subscriptionId: string, lastEvent?: string, provider?: string)`, `setPaymentFailed(customerId: string, lastEvent?: string, provider?: string)`, `setCancelled(customerId: string, lastEvent?: string, provider?: string)`.
  - Sheet range for reads/writes/appends becomes `A:J`; `HEADERS` gains `"provider", // J`.

- [ ] **Step 1: Write failing tests** (`memberships.test.ts`, following that file's existing mock style):
  - `new rows are written with provider in column J`: `setAwaitingSubscription("cus_1", {…, provider:"stripe"})` → the appended/updated row has 10 cells and `row[9] === "stripe"`; range strings end in `J`.
  - `reads a legacy 9-column row as provider ""` (mock `readRange` returning 9 cells): `getMembership("cus_1")` resolves with `provider === ""`, other fields unchanged.
  - `status change on a legacy row preserves columns A–I and stamps provider`: existing 9-cell row, `setActive("cus_1","sub_1","evt_1","stripe")` → written row equals old cells with `status:"active"`, `subscription_id:"sub_1"`, `last_event:"evt_1"`, `row[9] === "stripe"`.
  - `status change without a provider argument keeps the row's existing provider`.
  - `upsert-on-missing writes the passed provider` (and `""` when none passed).
  - `ensureSheet backfills the J1 header when empty`: existing sheet, `readRange("'Memberships'!J1:J1")` returns `[]` → `updateRange("'Memberships'!J1:J1", [["provider"]])` is called once; when J1 already has text it is not called; if that update throws, the public call still succeeds and a `membership_provider_header_backfill_failed` warning is logged.
  In `handle-payment-event.test.ts`: assert `setAwaitingSubscription` receives `provider: "stripe"` in its data, and `setActive`/`setPaymentFailed`/`setCancelled` are called with the provider as the **last** argument (`("cus_1","sub_1","cs_1","stripe")`, `("cus_1","in_9","stripe")`, `("cus_1","sub_1","stripe")`).
- [ ] **Step 2:** `npx vitest run src/lib/memberships.test.ts src/lib/payments/handle-payment-event.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement the interface above in `memberships.ts` (`rowToRecord` reads `row[9] ?? ""`; `recordToRow` emits 10 cells; `setStatus` takes the optional provider and does `record.provider = provider ?? record.provider`; `ensureSheet` additionally runs a best-effort J1 backfill after `ensureSheetWithHeaders`, cached by the existing `ensuredPromise`). In `handle-payment-event.ts` pass `event.provider` at every call site (checkout_completed, renewal_charged, renewal_failed, subscription events). In `bin/memberships-backfill.js` extend `HEADERS`, ranges and rows to 10 columns with `"stripe"` as the provider value (it only rebuilds Stripe members). Update the call-argument assertions in `stripe-webhook.test.ts` (`mockSetActive`, `mockSetAwaitingSubscription`, `mockSetCancelled`, `mockSetPaymentFailed`) to include the trailing `"stripe"`; change nothing else in that file.
- [ ] **Step 4:** `npm test` — Expected: PASS (only the argument assertions listed above changed in `stripe-webhook.test.ts`).
- [ ] **Step 5:** Land via zit: `feat(017): REQ-PP-007 Memberships provider column`.

---

### Task 3: Checkout Log `provider` column (J)

**Files:**
- Modify: `src/lib/google-sheets.ts` (`CheckoutLogEntry`, `appendCheckoutLog`), `src/lib/payments/handle-payment-event.ts` (two `appendCheckoutLog` calls)
- Test: `src/lib/google-sheets.test.ts`, `src/lib/payments/handle-payment-event.test.ts`

**Interfaces:**
- Produces: `CheckoutLogEntry.provider: string` (required). Row order: `timestamp, firstName, lastName, phone, email, plan, amountDisplay, sessionId, customerId, provider`; range `"A1:J1"`. (`sessionId` keeps its field name — it is the provider's checkout reference; column H must not move.)

- [ ] **Step 1: Write failing tests.** `google-sheets.test.ts` (existing `appendCheckoutLog` test at ~line 79–110): expect the appended row to have 10 cells with `provider` last and the range to be `"A1:J1"`, with the first nine cells unchanged. `handle-payment-event.test.ts`: both the renewal-checkout path and the option_c path call `appendCheckoutLog` with `provider: "stripe"`.
- [ ] **Step 2:** Run both files — Expected: FAIL.
- [ ] **Step 3:** Implement. The Checkout Log tab has no code-defined headers (admin-created); do not add header logic — Task 7 documents adding a `provider` header by hand.
- [ ] **Step 4:** `npm test` — PASS. Land via zit: `feat(017): REQ-PP-007 Checkout Log provider column`.

---

### Task 4: `/api/health` exposes `payment` (keeps `stripe` alias)

**Files:**
- Modify: `src/pages/api/health.ts`
- Test: `src/pages/api/health.test.ts`

**Interfaces:**
- Consumes: `getPaymentProvider()`, `PaymentProvider.healthCheck()` (plan 1).
- Produces response shape (all fields always present unless noted):
  - `status`, `email`, `renewal_prices` — unchanged.
  - `payment: { provider: string; status: "connected" | "disconnected" | "not_configured"; error?: string }` — `provider` is the active provider id, or when the provider cannot be resolved the raw configured value (`PAYMENT_PROVIDER` trimmed/lower-cased, default `"stripe"`).
  - `stripe: <same status string>` — **only when `payment.provider === "stripe"`** (alias kept for one release).
  - `errors.payment` whenever the payment check has an error; `errors.stripe` (same text) additionally only when `payment.provider === "stripe"`; `errors["renewal_prices.<slug>"]` unchanged.

- [ ] **Step 1: Write failing tests** (extend `health.test.ts`, keep its mocking approach): happy path `toEqual` now includes `payment: { provider: "stripe", status: "connected" }` alongside `stripe: "connected"`; `not_configured` case → `payment.status === "not_configured"` and `stripe === "not_configured"`; disconnected case → `errors.payment` and `errors.stripe` both contain the message; invalid provider (`PAYMENT_PROVIDER=paypal`) → status 200, `status: "degraded"`, `payment: { provider: "paypal", status: "not_configured", error: <message containing 'Unknown PAYMENT_PROVIDER "paypal"'> }`, **no `stripe` key**, `errors.payment` set, `errors.stripe` absent; `PAYMENT_PROVIDER=" Stripe "` still reports `provider: "stripe"` with the alias.
- [ ] **Step 2:** `npx vitest run src/pages/api/health.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement in `health.ts` (build `payment`, derive the alias conditionally; keep logging event names `health.stripe_check_failed` etc. unchanged).
- [ ] **Step 4:** `npm test` — PASS. Land via zit: `feat(017): REQ-PP-008 health payment key with stripe alias`.

---

### Task 5: Alert worker reads `payment` first, falls back to `stripe`

**Files:**
- Create: `.run/health-alert-worker/summarize.mjs` (pure helper `summarizeResult(r)`; moved out of `worker.mjs`, which imports it — a named export from the worker entry file is avoided on purpose)
- Modify: `.run/health-alert-worker/worker.mjs`
- Test: `src/lib/health-alert-summarize.test.ts` (imports `../../.run/health-alert-worker/summarize.mjs`; if `npm run check` reports a missing-types error for the `.mjs` import, add a sibling `summarize.d.mts` declaring the function)

**Interfaces:**
- Produces: `summarizeResult(r: { name; ok; httpStatus; latencyMs; body: any; error }) → { name, ok, httpStatus, latencyMs, provider, payment, email, status, error }` where `provider = body?.payment?.provider ?? (body?.stripe !== undefined ? "stripe" : undefined)` and `payment = body?.payment?.status ?? body?.stripe`.
- Alert decision logic (`ok = res.ok && body.status === "ok"`) is unchanged.

- [ ] **Step 1: Write failing tests.** New-shape body `{status:"ok", payment:{provider:"airwallex",status:"connected"}, email:"connected"}` → `provider:"airwallex"`, `payment:"connected"`. Old-shape body `{status:"ok", stripe:"connected", email:"connected"}` → `provider:"stripe"`, `payment:"connected"`. Both keys present → `payment` wins. `body: null` (fetch failed) → `payment`/`provider` undefined, no throw. `status`/`email`/`error` pass through.
- [ ] **Step 2:** `npx vitest run src/lib/health-alert-summarize.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3:** Create `summarize.mjs`, import it in `worker.mjs`, delete the old inline function there.
- [ ] **Step 4:** `npx vitest run src/lib/health-alert-summarize.test.ts && node --check .run/health-alert-worker/worker.mjs && npm run check` — PASS. Land via zit: `feat(017): REQ-PP-008 alert worker reads payment health key`.

---

### Task 6: Dry-run wording is provider-neutral

**Files:**
- Modify: `src/pages/api/create-checkout-session.ts:~175`, `src/pages/api/advanced/upload-complete.ts:~140` (message text), `src/pages/index.astro:161`, `src/pages/apply.astro:123`, `src/pages/advanced/apply.astro:1182` (client fallbacks)
- Test: `src/pages/api/create-checkout-session.test.ts` (~line 159), `src/pages/api/advanced/upload-complete.test.ts` (dry-run case)

**Interfaces:** both API routes return `message: "CHECKOUT_DRY_RUN is enabled. Payment provider keys and price configuration validated; no checkout was created."`; client fallbacks read `"Dry run passed. Payment configuration validated."`. Response keys otherwise identical.

- [ ] **Step 1:** Change the two dry-run test assertions to the new message (`toContain("Payment provider keys and price configuration validated")`; in `upload-complete.test.ts` add the same assertion to the dry-run test).
- [ ] **Step 2:** Run both test files — Expected: FAIL.
- [ ] **Step 3:** Change the five strings. Check `e2e/` for a copy of the old text: `grep -rn "Stripe configuration validated\|Stripe keys and price" e2e src` must print nothing afterwards.
- [ ] **Step 4:** `npm test` — PASS. Land via zit: `refactor(017): REQ-PP-008 provider-neutral dry-run copy`.

---

### Task 7: Docs, upgrade notes, spec status

**Files:**
- Modify: `docs/forms/migration-map.md` (rows `L` Renewals and the applicant sheet's AQ: `payment_ref` with a "(was `stripe_session`; column unchanged)" note; add Memberships `J provider` and Checkout Log `J provider` as managed cells), `docs/membership-applications-overview.md` (AQ row at ~208, Checkout Log section at ~168/227/359/435: ten columns, `provider` last), `docs/CUSTOMIZE.md` (new subsection under §5 "Upgrading an existing deployment" — see below), `spec/008-…/requirements.md`, `spec/008-…/design.md`, `spec/010-…/design.md`, `spec/000-…/design.md`, `spec/005-…/requirements.md`, `spec/005-…/design.md` (each `stripe_session` mention → `payment_ref` plus "(renamed from `stripe_session` by spec 017)" on first mention per file), `spec/011-health-monitoring-alerting/requirements.md` (document the `payment` key and `stripe` alias), `spec/017-payment-provider-abstraction/requirements.md` + `tasks.md` (REQ-PP-007/008 move from "Planned" to implemented; list plan 2's tasks)

**CUSTOMIZE.md upgrade text must say, in this order:**
1. Deploy the app first. Nothing breaks: sheet reads are positional, old header text keeps working, `/api/health` still returns `stripe`.
2. Optional: rename the header cell `stripe_session` → `payment_ref` (applicant sheet AQ1, Renewals L1, Basic Applications if present). Purely cosmetic.
3. Memberships column J (`provider`): the app writes the header automatically when J1 is empty; legacy rows are stamped `stripe` the next time a Stripe event touches them. Checkout Log column J: add a `provider` header by hand.
4. Redeploy the health-alert worker (`wrangler deploy` from `.run/health-alert-worker/`) at any time after step 1; old and new workers both work against old and new apps.

- [ ] **Step 1:** Make the edits. **Step 2:** `grep -rn "stripe_session" docs spec README.md CLAUDE.md` — every remaining hit must be inside a "(was `stripe_session`)" / "renamed from" note. **Step 3:** `npm test` (docs-only, sanity) PASS. Land via zit: `docs(017): REQ-PP-007 REQ-PP-008 migration notes and spec status`.

---

### Task 8: Final verification

- [ ] **Step 1:** `npm test`, `npm run check`, `npm run build` — all green. **Step 2:** `npm run test:e2e` (Playwright, `CHECKOUT_DRY_RUN=true`) — pass. **Step 3:** Plan-1 constraint greps still clean: `grep -rln 'from "stripe"' src --include='*.ts' | grep -v '\.test\.ts' | grep -v 'src/lib/payments/stripe/'` prints nothing; `grep -rn "dahlia" src | grep -v '\.test\.ts'` shows only `payments/stripe/client.ts`. **Step 4:** `grep -rn "stripe_session\|stripeSession\|getRenewalByStripeRef" src bin .run` prints nothing. **Step 5 (not automatable — report to the user):** one real Stripe test-mode signup + renewal against a copy of the production sheet layout, confirming a legacy Memberships row gains `provider=stripe`.
