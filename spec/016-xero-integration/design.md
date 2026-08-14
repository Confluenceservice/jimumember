# Design — Xero Accounting Sync

> Spec ID: `016` · Type: system feature
> Depends on: `000-platform-overview`, `007-stripe-checkout-flow`, `008-stripe-webhook-side-effects`, `013-google-workspace-integration`, `015-environment-configuration`

## Overview

Sheet-as-queue, inline push, external retry. Three moving parts:

1. The webhook enqueues the payment and attempts the Xero push inline.
2. The `Xero Sync` tab is the durable record, the idempotency gate, and the
   debugging join key.
3. An hourly Apps Script GET re-drives whatever is still `pending`.

## Component Design

| File | Role |
|---|---|
| `src/lib/xero-auth.ts` | Token acquisition for both modes, tenant guard, consent-URL builder, code exchange |
| `src/lib/xero-token-store.ts` | Refresh token + one-shot OAuth state nonce, stored in the `Xero Auth` sheet tab |
| `src/lib/xero-client.ts` | Thin Xero REST wrapper. `XeroApiError` carries the permanent/transient verdict; 401 invalidates the cached token and retries once |
| `src/lib/xero-sync-sheet.ts` | The `Xero Sync` tab: `appendPending`, `findByStripeId`, `markDone`, `markAttemptFailed`, `listPending` |
| `src/lib/xero-sync.ts` | Orchestration: `enqueueAndPush` (webhook path), `pushOne` (idempotent write), `sweepPending` (retry path) |
| `src/lib/stripe-payment-facts.ts` | Resolves `paidAt` + `feeCents` from the Stripe balance transaction |
| `src/lib/secret-compare.ts` | Timing-safe shared-secret comparison |
| `src/pages/api/xero/sync-pending.ts` | Sweeper endpoint |
| `src/pages/api/xero/oauth/{start,callback}.ts` | Consent flow (`authcode` only) |
| `apps-script/xero-sweeper/` | Standalone hourly trigger |

## Flow

```
checkout.session.completed / invoice.payment_succeeded
   │
   ├─ (existing side effects: sheet writes, review Doc, emails)
   │
   └─ await pushToXero(...)                       // stripe-webhook.ts
        │  isXeroEnabled()? ─no─► return          // REQ-XI-001
        │
        ├─ getPaymentFacts(stripe, source)        // REQ-XI-010
        └─ enqueueAndPush(record)                 // never rejects, REQ-XI-009
             │  assertEnvironmentSafe(livemode)   // REQ-XI-003 (before append)
             ├─ appendPending(record)             // REQ-XI-013 dedupe on stripe_id
             └─ pushOne(record)
                  │  findInvoiceByNumber(stripeId)
                  │     ├─ found + paid ─────────► markDone           (no-op re-drive)
                  │     └─ found + unpaid ───────► createPayment ► markDone
                  └─ not found:
                        findContactByNumber(email) ?? createContact
                        createInvoice ► createPayment ► markDone
                                    │
                  on throw ─────────┴──► markAttemptFailed(permanent?)
```

Hourly: `GET /api/xero/sync-pending` → `sweepPending()` → `listPending()` →
per row, re-check `livemode` → `pushOne`.

## Why a sheet tab and not a queue

`fly.toml` runs one 256 MB machine with `min_machines_running = 0` and
`auto_stop_machines = 'stop'`. A detached promise scheduled after the webhook
response may never run. There is no Redis and no worker. The same constraint
already shapes `appendCheckoutLog`, so the failure class is familiar and the
recovery (an external GET that also wakes the machine) is cheap.

## Idempotency, in three independent layers

1. **Sheet** — `appendPending` is a no-op when `stripe_id` is present.
2. **Xero** — `InvoiceNumber` is the Stripe id, so a re-drive finds the
   existing invoice.
3. **Resume** — an existing-but-unpaid invoice resumes at the payment step
   rather than creating a second invoice.

Layer 3 is what makes it safe for `markDone` to swallow its write failure: a
row left `pending` but done in Xero is re-driven into a no-op. **Do not keep
`markDone` swallowing if the resume path is ever removed.**

## Failure classification

| Class | Examples | Row outcome |
|---|---|---|
| Permanent | `XeroApiError.permanent` (4xx payload rejections), `MISSING_CONFIG`, `XERO_BAD_DATE` | `failed_permanent` — needs a human, never retried |
| Transient | 429, 5xx, network, expired token | stays `pending` — swept next hour |

`MISSING_CONFIG` is deliberately permanent: retrying hourly will not set an
account code, and a stuck `pending` row hides the operator error.

## Auth

Both modes share one token cache and one in-flight promise. In `authcode` mode
a double refresh is not merely wasteful — the second request presents a token
the first has already rotated away, which Xero rejects and which can brick the
connection.

Ordering differs by path, deliberately:

- **Refresh**: persist the new refresh token **first**. The old one is already
  dead, so a failed write must fail the refresh.
- **Consent exchange**: verify the tenant **first**. There is no prior token to
  lose, and nothing should be persisted if consent granted the wrong org.

## Data contracts

- `XeroSyncFlow` values (`advanced_new`, `basic_new`, `renewal`,
  `auto_renewal`) — column C, stored verbatim.
- `Xero Sync` columns A–R, in the documented order.
- `Xero Auth` tab — refresh token + OAuth state nonce.

Same rule as every other sheet in the platform: labels are free, stored values
and column order are not.

## Security

- Two distinct shared secrets. `XERO_SYNC_SECRET` is a header;
  `XERO_CONSENT_SECRET` is a query parameter (a redirect cannot carry a
  header) and therefore lands in access logs, so it is rotated after
  connecting. Both compare timing-safely and fail closed when unset.
- The OAuth `state` nonce is single-use and cleared on callback.
- `/api/xero/` is rate-limiter-exempt by design (REQ-XI-026); the secrets are
  the access control.
- Token responses are never logged.

## Testing Strategy

- Unit: `xero-auth`, `xero-client`, `xero-sync`, `xero-sync-sheet`,
  `xero-token-store`, `stripe-payment-facts`, `secret-compare` — each with a
  co-located `.test.ts`.
- Route: `sync-pending`, `oauth/start`, `oauth/callback` — auth gating,
  disabled-mode reporting, nonce consumption.
- Integration: the `Xero sync` block in `src/pages/api/stripe-webhook.test.ts`
  — one test per flow, livemode propagation, swallowed-failure 200, and the
  disabled-fork fast path.
- Live: the staging checklist in `tasks.md` against the Xero Demo Company.
