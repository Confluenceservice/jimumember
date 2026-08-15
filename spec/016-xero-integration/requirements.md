# Requirements — Xero Accounting Sync

> Spec ID: `016` · Type: system feature · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `007-stripe-checkout-flow`, `008-stripe-webhook-side-effects`, `013-google-workspace-integration`, `015-environment-configuration`
> Source today: `src/lib/xero-*.ts`, `src/pages/api/xero/**`, `apps-script/xero-sweeper/`
> Runbook: `docs/runbooks/xero-connect.md`

## Overview

Every completed Stripe payment becomes a Xero Contact plus a paid `ACCREC`
invoice booked against a Stripe clearing account, so the treasurer reconciles
the Stripe feed instead of hand-keying membership income.

The integration is **optional and off by default** — the blueprint ships it
inert so a fork that does not use Xero pays no runtime cost.

There is no queue and no worker process: the platform runs one 256 MB Fly
machine with `min_machines_running = 0`, so a promise scheduled after the
webhook response can be killed with the machine. The durable queue is a sheet
tab; the retry mechanism is an external hourly GET.

## Functional Requirements

### Enablement + environment safety

- **REQ-XI-001** The integration is a no-op unless `XERO_ENABLED` is truthy
  (`true` / `1` / `yes` / `on`, case-insensitive). Unset means no Xero code
  path executes and no extra Stripe API call is made.
- **REQ-XI-002** Two auth modes behind one interface, selected by
  `XERO_AUTH_MODE`: `custom` (`client_credentials`, no consent, no refresh
  token) and `authcode` (authorization code + rotating refresh token). An
  absent or unrecognised value is `MISSING_CONFIG`, never a silent default.
- **REQ-XI-003** Environment guard, layer 1: the Stripe event's `livemode`
  must equal `XERO_ALLOW_LIVE`. A mismatch refuses to act and is logged; no
  row is written, so the sweeper cannot pick it up later.
- **REQ-XI-004** Environment guard, layer 2: the resolved token must grant
  access to `XERO_TENANT_ID` (checked against `GET /connections`). A mismatch
  throws `XERO_TENANT_MISMATCH`.
- **REQ-XI-005** In `authcode` mode the rotated refresh token is persisted
  **before** the paired access token is used. Xero invalidates the presented
  token the moment it answers, so a lost write bricks the connection.
- **REQ-XI-006** Concurrent token acquisitions are serialised through a single
  in-flight promise, which is cleared on rejection so a failed refresh is
  never cached.

### Payment capture

- **REQ-XI-007** Four payment flows are captured, keyed by `XeroSyncFlow`:
  `advanced_new`, `basic_new`, `renewal`, `auto_renewal`. These strings are
  written verbatim to the sheet and are a production contract.
- **REQ-XI-008** The Xero push is **awaited** inside the webhook handler, never
  fire-and-forget (the machine may stop immediately after the response).
- **REQ-XI-008a** Every paid `option_c` session of a known tier is pushed
  exactly once, whether or not it carries an application id. `applicant_id` is
  set only by the advanced upload flow and `basic_application_id` only by
  `/apply`; a direct purchase from the landing page carries neither, and
  `internal_id` falls back to the Stripe session id. Gating on those ids would
  take the money and never enqueue a row — which the sweeper cannot recover,
  because it only re-drives rows that exist.
- **REQ-XI-009** The push never propagates an error to the webhook route. A
  Xero outage costs a `pending` row and nothing else — a 500 would make Stripe
  replay the event and re-fire non-idempotent side effects (review Doc,
  confirmation email, admin notification).
- **REQ-XI-010** `paid_at` comes from the Stripe **balance transaction**, not
  `Date.now()`. A payment dated in a different period from the feed line will
  not auto-match. When the balance transaction cannot be resolved, the fallback
  is used and logged.
- **REQ-XI-011** Contact email is normalised (trimmed, lower-cased) before use:
  Xero `ContactNumber` is keyed on it and must be stable.

### Queue tab (`Xero Sync`)

- **REQ-XI-012** Columns A–R, in order: `stripe_id`, `event_type`, `flow`,
  `internal_id`, `email`, `contact_name`, `amount_cents`, `currency`,
  `paid_at`, `fee_cents`, `status`, `xero_contact_id`, `xero_invoice_id`,
  `xero_payment_id`, `attempts`, `last_error`, `updated_at`, `livemode`.
- **REQ-XI-013** `stripe_id` is the primary idempotency key. Appending a
  record whose `stripe_id` is already present is a no-op, so a Stripe replay
  carrying a fresh event id cannot enqueue the same payment twice.
- **REQ-XI-014** `status` ∈ `pending` | `done` | `failed_permanent`. Only
  `pending` rows are swept. Any unrecognised value reads as `pending`.
- **REQ-XI-015** Reads fail open (`null` / `[]`); writes log and swallow.
- **REQ-XI-016** `last_error` is truncated to 500 characters.
- **REQ-XI-017** Each row stores its own `livemode`, so a sweep re-checks
  REQ-XI-003 against the row rather than the current event.

### Xero write path

- **REQ-XI-018** Invoice `InvoiceNumber` is the Stripe id — deterministic, so
  a re-drive finds the existing invoice instead of creating a second one.
- **REQ-XI-019** `pushOne` is resumable: an existing invoice that is fully paid
  marks the row done; an existing unpaid invoice resumes at the payment step.
- **REQ-XI-020** `LineAmountTypes: "NoTax"` and an env-overridable `TaxType` —
  the invoice total must equal the Stripe gross to the cent, or the payment
  part-allocates and the clearing account never nets to zero.
- **REQ-XI-021** Payments are booked against `XERO_STRIPE_FEED_ACCOUNT_ID`
  (the clearing account UUID), never a real bank account. Stripe fees are left
  to bank rules; `fee_cents` is logged for reconciliation only.
- **REQ-XI-022** Failures are classified permanent vs transient. Permanent
  (`XeroApiError.permanent`, `MISSING_CONFIG`) moves the row to
  `failed_permanent` and out of the sweeper's reach; everything else stays
  `pending`.

### Endpoints + sweeper

- **REQ-XI-023** `GET /api/xero/sync-pending` re-drives pending rows
  sequentially and returns `{enabled, swept, done, stillPending,
  permanentFailures}`. Gated on the `X-Sync-Secret` header matching
  `XERO_SYNC_SECRET` via a timing-safe comparison; an unset secret denies
  every request.
- **REQ-XI-024** `GET /api/xero/oauth/start` (authcode only) redirects to Xero
  consent. Gated on `XERO_CONSENT_SECRET` as a **query parameter** — a browser
  redirect cannot carry a header — which is why it is a separate secret from
  `XERO_SYNC_SECRET` and is rotated after connecting.
- **REQ-XI-025** `GET /api/xero/oauth/callback` exchanges the code, verifies
  the tenant **before** persisting anything, and consumes a single-use state
  nonce.
- **REQ-XI-026** All `/api/xero/` routes are exempt from the IP rate limiter:
  they are machine-to-machine and share the `unknown` bucket, where 30 req /
  15 min would throttle the sweeper and could burn the one-shot callback.
  Each route carries its own shared secret or nonce.
- **REQ-XI-027** When `XERO_ENABLED` is off, the sweep endpoint reports
  `{"enabled":false,…}` rather than 404, so the cause is visible in the
  trigger's log.
- **REQ-XI-028** The hourly sweep is an external Apps Script trigger
  (`apps-script/xero-sweeper/`). Its inbound request also wakes the stopped
  Fly machine.

## Non-Functional Requirements

- **NFR-XI-001** The inline push is three Xero API calls, comfortably inside
  Stripe's webhook timeout.
- **NFR-XI-002** Sweeps are sequential — one small machine, and Xero rate-limits
  per tenant, so parallelism buys 429s.
- **NFR-XI-003** Token bodies are never logged (they carry the access token and
  the rotated refresh token). Error codes are; tenant UUIDs are, because the
  guard is otherwise undiagnosable.
- **NFR-XI-004** No Xero secret is ever exposed to client code.

## Acceptance Criteria

1. `XERO_ENABLED` unset → no Xero call, no `getPaymentFacts` call, webhook 200.
2. A paid advanced application enqueues one `advanced_new` record with a
   normalised email and the balance-transaction `paidAt`.
3. Replaying the same Stripe event does not create a second sheet row or a
   second Xero invoice.
4. A test-mode event on a deployment with `XERO_ALLOW_LIVE=true` writes
   nothing and logs the guard.
5. A Xero outage leaves the row `pending` and still returns 200.
6. The next sweep completes that row; a second sweep is a no-op.
7. A process kill between invoice and payment creation is repaired by the next
   sweep (payment created, no duplicate invoice).
8. `sync-pending` without the correct `X-Sync-Secret` returns 401.

## Out of Scope

- Xero bank rules, feed configuration, and payout reconciliation (Xero-side
  setup, covered by the runbook).
- Credit notes, refunds, and disputes.
- Sales-tax-registered orgs (see `docs/CUSTOMIZE.md` §6c).
- Same-name Contact disambiguation — Xero's uniqueness behaviour on `Name` is
  unverified against a live org; see the in-code note in `pushOne`.
- **The pre-Xero replay window.** Both renewal handlers return early on their
  own ledger idempotency check (`renewal.paymentStatus === "paid"`,
  `getRenewalByStripeRef(invoiceId)`), and those checks sit *before* the Xero
  push. A process death between the ledger write and `appendPending` means the
  Stripe replay returns early and the payment is never enqueued. REQ-XI-013
  guarantees replays do not *duplicate*; it does not guarantee they recover
  this window. Detection is reconciliation-side: the clearing account does not
  net to zero. Closing it would mean moving the Xero push ahead of the ledger
  idempotency gates, which trades a rare miss for a common double-push.
