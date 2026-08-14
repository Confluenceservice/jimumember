# Tasks — Xero Accounting Sync

> Spec ID: `016` · Type: system feature
> Status: backfilled on port. Code shipped; live validation outstanding.

## Phase 1: Auth
- [x] `custom` (client_credentials) mode — REQ-XI-002
- [x] `authcode` mode with rotating refresh token — REQ-XI-002, REQ-XI-005
- [x] Tenant guard against `GET /connections` — REQ-XI-004
- [x] Single in-flight refresh, cleared on rejection — REQ-XI-006
- [x] Refresh token + state nonce in the `Xero Auth` tab

## Phase 2: Queue tab
- [x] `Xero Sync` A–R schema — REQ-XI-012
- [x] `stripe_id` dedupe on append — REQ-XI-013
- [x] Status transitions + 500-char `last_error` — REQ-XI-014, REQ-XI-016
- [x] Reads fail open, writes swallow — REQ-XI-015
- [x] Per-row `livemode` — REQ-XI-017

## Phase 3: Push
- [x] Contact → invoice → payment, deterministic `InvoiceNumber` — REQ-XI-018
- [x] Resume a half-finished push — REQ-XI-019
- [x] `NoTax` + env-overridable `TaxType` — REQ-XI-020
- [x] Clearing-account payments, fees logged only — REQ-XI-021
- [x] Permanent vs transient classification — REQ-XI-022
- [x] `paidAt` / `feeCents` from the balance transaction — REQ-XI-010

## Phase 4: Wiring
- [x] `pushToXero` awaited at all four webhook call sites — REQ-XI-007, REQ-XI-008
- [x] Never propagates an error to the route — REQ-XI-009
- [x] Environment guard before append — REQ-XI-003
- [x] `/api/xero/` rate-limiter exemption — REQ-XI-026
- [x] Disabled by default; no `getPaymentFacts` call when off — REQ-XI-001

## Phase 5: Endpoints + sweeper
- [x] `GET /api/xero/sync-pending` with `X-Sync-Secret` — REQ-XI-023, REQ-XI-027
- [x] `GET /api/xero/oauth/start` with consent secret — REQ-XI-024
- [x] `GET /api/xero/oauth/callback` with single-use nonce — REQ-XI-025
- [x] Apps Script hourly trigger — REQ-XI-028

## Phase 6: Docs
- [x] `docs/runbooks/xero-connect.md`
- [x] `docs/CUSTOMIZE.md` §6c + pre-deploy checklist item
- [x] `.env.example` block

## Phase 7: Staging validation (Xero Demo Company) — OUTSTANDING

Run in a single sitting: the Demo Company resets every 28 days and takes the
connection with it. Set `XERO_ALLOW_LIVE=false`.

- [ ] Confirm `GET /connections` really exposes `tenantId` (not the
      connection's own `id`) — the guard silently never matches if this is
      wrong. Flagged in-code in `resolveTenantId`.
- [ ] Confirm the org's real zero-tax `TaxType` via `GET /TaxRates`; set
      `XERO_TAX_TYPE` accordingly.
- [ ] Test payment per flow (`advanced_new`, `basic_new`, `renewal`,
      `auto_renewal`) → invoice total equals Stripe gross to the cent.
- [ ] Invoice date equals the balance-transaction date, not today.
- [ ] Replay the same Stripe event → no second row, no second invoice.
- [ ] Live-mode event against the Demo Company → guard refuses, nothing written.
- [ ] Kill the process between invoice and payment creation → next sweep
      repairs it without a duplicate invoice.
- [ ] Two members with the same name, different emails → record what Xero
      actually does (open question in `pushOne`).
- [ ] `sync-pending` with a wrong secret → 401; with `XERO_ENABLED` off →
      `{"enabled":false,…}`.

## Phase 8: Production cutover — OUTSTANDING

Only these are production-only; the Demo Company has no Stripe feed.

- [ ] `XERO_ALLOW_LIVE=true`, real tenant, real account codes
- [ ] Feed charge lines auto-match the created payments
- [ ] Clearing account nets to zero after a payout
- [ ] Bank rules code the Stripe fees
- [ ] Sweeper trigger installed against the production base URL

## Notes
- The webhook pushes inline and gives up after one attempt; the hourly sweep is
  the entire retry mechanism (`min_machines_running = 0`).
- Flow keys and `Xero Sync` column order are production contracts once rows
  exist.
