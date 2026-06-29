# Requirements — Platform Overview

> Spec ID: `000` · Type: platform/index · Status: backfilled (not yet approved)
> Depends on: —
> Referenced by: every other spec in `spec/`

## Overview

Re:Member is an Astro + Stripe + Google-Workspace membership platform blueprint. It manages the full member lifecycle for a small membership organisation: application, review, payment, renewal, and post-renewal professional-development (PD) logging. Sheets is the database, Drive is the document store, Docs is the review surface. No CMS. Volunteer admin runs it from a spreadsheet.

This spec is the **index** — it establishes shared vocabulary (state machine, tier abstraction, sheet contracts, env-var taxonomy) used by every feature spec. New requirements referenced from a feature spec must trace back to a REQ-ID defined here or in the feature spec itself.

## Business Requirements

- **BR-OV-001** Single deployable blueprint that can be forked and rebranded for any small membership organisation without code changes to the lifecycle logic.
- **BR-OV-002** Volunteer admin operates the system from Google Sheets alone. No separate admin UI.
- **BR-OV-003** Members self-serve their full lifecycle: apply, upload documents, pay, resume, renew, log PD.
- **BR-OV-004** Post-payment side effects (review doc, notifications, PD-link email) run automatically without admin intervention.

## Functional Requirements

### Domain model

- **REQ-OV-001** Member lifecycle state machine: `new → partial → complete → paid`. Transitions:
  - `new → partial`: first autosave persists form data.
  - `partial → complete`: all required form fields filled AND all required document categories have ≥1 uploaded file.
  - `complete → paid`: Stripe `checkout.session.completed` webhook flips the `paid` flag.
- **REQ-OV-002** Tier abstraction: today `basic` and `advanced`; extensible to N tiers via the `TIERS` frozen config in `src/lib/forms/tiers.ts`. Storage values (`pm→adv`, `am→basic`) decouple internal keys from public labels.
- **REQ-OV-003** Sheet-of-truth contracts:
  - **Advanced Applications** — 47 columns A–AU (identity, form data, declarations, resume token, upload counts, workflow state).
  - **Basic Applications** — 16 columns A–P (identity, 1-step form, checkout status).
  - **Renewals** — 14 columns A–N (shared between tiers; PD entries as JSON in column H).
  - **Drive Files** — 6 columns A–F (one row per uploaded file, lazy-created on first upload).
- **REQ-OV-004** Resume flow: token-first lookup using the `resume_token` column. Email fallback only when no token supplied. `GET /api/advanced/apply?token=...` returns `applicantId` for reliable hydration.
- **REQ-OV-005** Email verification: a token link flips column AU (`email_verified`) to `TRUE`. Blank = legacy row, treated as verified. Verified applicants cannot be hijacked by email reuse.
- **REQ-OV-006** Flag parsing is case-insensitive: `true`, `TRUE`, `True` are all accepted on read for `complete`/`paid`/declaration columns.
- **REQ-OV-007** Stripe Option C flow: first-term checkout is a one-time charge (`mode=payment`), recurring subscription is created with `trial_end` set to the next July 1 (or `RENEWAL_ANCHOR_MONTH`/`DAY` if overridden). Metadata carries `flow: "option_c"`, `recurring_price_id`, `next_july1_epoch` for webhook dispatch.
- **REQ-OV-008** Org-identity env vars (`ORG_NAME`, `SUPPORT_EMAIL`, `ADMIN_EMAIL`, `PUBLIC_ORG_URL`, `PUBLIC_APP_URL`) are interpolated into every email subject, body, and admin notification. Changing an org's identity requires no code changes.

### API surface

- **REQ-OV-009** API endpoints under `src/pages/api/`. Per-route TypeScript files. JSON in, JSON out. No GraphQL. Webhook routes accept Stripe signature verification.
- **REQ-OV-010** Error responses include a `code` enum (`INVALID_TOKEN`, `INCOMPLETE`, `ALREADY_COMPLETED`, `CHECKOUT_ERROR`, `MISSING_CONFIG`) and optional `retryable: boolean`. Clients use `code` to render typed error banners.
- **REQ-OV-011** Rate-limit handling: 429 responses surface the `Retry-After` header to the user with a friendly wait message. The "Proceed to Payment" client retries network errors and 502/503/504 with exponential backoff (1s/2s/4s).

### Integrations

- **REQ-OV-012** Google Workspace is accessed via a single Service Account with Domain-Wide Delegation impersonating a Workspace user. Three APIs: Sheets (read/write), Drive (upload/delete), Docs (review doc generation).
- **REQ-OV-013** Mailgun is the sole transactional email provider. Region-aware: API base URL derived from `MAILGUN_REGION` if set. Gmail OAuth fallback removed.
- **REQ-OV-014** Stripe is the sole payment provider. Webhook signature verified against `STRIPE_WEBHOOK_SECRET`. Dry-run mode (`CHECKOUT_DRY_RUN=true`) validates config without creating sessions.

## Non-Functional Requirements

- **NFR-OV-001** Test coverage: 282+ unit tests pass via `npm run test`. Vitest, co-located `*.test.ts` files.
- **NFR-OV-002** Type safety: `npm run check` reports 0 errors. Strict TypeScript.
- **NFR-OV-003** Autosave resilience: client-side queue serialises requests per applicant. Server-side per-applicant queue prevents interleaved writes.
- **NFR-OV-004** File limits: max 10MB per file, allowed types PDF/JPEG/PNG/GIF/DOC/DOCX. Enforced server-side.
- **NFR-OV-005** Health check: `/api/health` probes Stripe + Mailgun + renewal price resolution. Cloudflare Worker cron posts failures to Slack.

## Acceptance Criteria

1. New advanced applicant: all 47 columns write to the correct Sheet tab.
2. Resume link: form pre-populates from stored state, including `applicantId`.
3. Upload 3 files to `training` category: all 3 rows in Drive Files sheet, all 3 visible in upload UI.
4. Delete middle file: file soft-deleted (`deleted=TRUE`), remaining 2 still shown.
5. "Proceed to Payment" activates only when all 6 required doc categories have ≥1 file AND all required form fields filled.
6. Stripe payment → webhook fires → `paid=TRUE` → review doc created → confirmation email sent.
7. Existing (pre-Phase-2) applicant resume link still works (backwards compat).
8. `CHECKOUT_DRY_RUN=true`: "Proceed to Payment" returns `{dryRun: true, stripeKeysValidated: true}` without hitting Stripe.

## Out of Scope

- Multiple orgs in one deploy (tenancy model is single-org per Fly app).
- Member self-service account editing post-payment (no member portal).
- Admin web UI (Sheets is the admin surface).
- Real-time notifications (webhook-driven only; no push/SSE).
- Internationalisation (single locale per org).

## Risks and Assumptions

### Risks
- Sheets as DB: rate-limited at ~60 writes/minute per service account. Mitigation: batch writes, retry-with-jitter in `renewal-sheet.ts`.
- DWD impersonation requires a real Workspace tenant. Mitigation: clear runbook at `docs/runbooks/google-workspace-domain-wide-delegation.md`.

### Assumptions
- Each Fly app (staging + production) has its own Stripe webhook endpoint and its own Sheets workbook.
- Org's membership year anchors on July 1 unless overridden.
- Admin email (`ADMIN_EMAIL`) is monitored daily.

## Related

- `.wolf/cerebrum.md` — design decisions (Phase K/L/M tier abstraction rationale)
- `.wolf/buglog.json` — known issues (bug-001..bug-004)
- `docs/DEPLOY.md` — 15-phase deployment runbook
- `docs/CUSTOMIZE.md` — pre-deployment customisation checklist