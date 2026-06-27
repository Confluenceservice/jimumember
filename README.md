# Re:Member — Membership Platform Blueprint

Membership + onboarding + renewal stack for volunteer-run orgs. Stripe-backed. Sheets-as-DB. Built for not-for-profits and small membership clubs whose admin time is precious and whose treasurer shouldn't spend weekends chasing forms and receipts.

> **Before deploying:** read [`docs/CUSTOMIZE.md`](docs/CUSTOMIZE.md). The blueprint ships with sample form content from a single professional-membership org; you must replace it before real applicants.

## What it does

End-to-end member lifecycle for Re:Member (and any similar professional/associate membership org):

- **Associate membership signup** — one-page checkout, Stripe-hosted payment.
- **Professional membership application** — 8-step digital form (about you, training, experience, core competencies, referees, declarations), multi-file document upload (training certs, ethics, criminal check, advance care, assisted dying, palliative care, insurance), resume-by-link, autosave, admin review via auto-generated Google Doc.
- **Annual membership renewal** — Stripe-hosted Payment Links for both tiers (Pro $150 / Associate $75). One-time payment, no subscription to babysit.
- **PD (professional development) logging** — members submit PD entries post-renewal; admins notified by email.
- **Post-payment side effects** — Stripe webhook fires Google Sheets logging, Google Doc review creation, resume-link emails via Mailgun.
- **Health check + alerting** — `/api/health` probes Stripe + email; Cloudflare Worker cron posts failures to Slack.

No-CMS. Sheets-as-DB. Drive-as-DMS. Volunteer admin runs it from the spreadsheet. Money goes straight to Stripe.

## Stack

- **Astro SSR** + TypeScript + Tailwind
- **Stripe Checkout / hosted Payment Links** for payments
- **Google Sheets** as the system of record (`Professional Applications`, `Renewals`, `Checkout Log`, `Email Log`)
- **Google Drive** for uploaded applicant documents + generated review Docs
- **Google Service Account + Domain-Wide Delegation** (`it-admin@example.com`) for all Workspace access
- **Mailgun** transactional email (resume links, PD log notifications, admin alerts)
- **Fly.io** hosting (staging `remember-staging.fly.dev`, production `subscribe.example.com`)
- **Cloudflare Worker** cron for `/api/health` alerting → Slack
- **Vitest** for unit tests

## Surface

### Public pages
- `/` — Associate membership checkout landing + form
- `/professional` — Professional membership landing → `/professional/apply`
- `/professional/apply/` — 8-step application wizard with resume-by-token support
- `/renew/pro` — Pro membership renewal (payment-only, hosted Payment Link)
- `/renew/associate` — Associate membership renewal (payment-only, hosted Payment Link)
- `/renew/success`, `/cancel` — post-payment redirects
- `/associate-membership`, `/professional/cancel`, `/success`, `/success-upload`, `/cancel-upload` — Stripe redirect targets

### API
- `GET  /api/professional/apply?token=…` — hydrate form from resume token
- `POST /api/professional/apply` — save / upsert application (token or new)
- `POST /api/professional/upload-file` — JSON or multipart file upload to Drive
- `POST /api/professional/delete-file` — soft-delete file + trash Drive copy
- `POST /api/professional/upload-complete` — creates Stripe Checkout session (or dry-runs if `CHECKOUT_DRY_RUN=true`)
- `POST /api/professional/resend-link` — re-send resume email
- `POST /api/create-checkout-session` — Associate checkout
- `POST /api/create-professional-checkout` — Professional checkout
- `POST /api/stripe-webhook` — payment events → Sheets logging + Doc review + emails
- `POST /api/renew/checkout-pm` — Pro renewal session
- `POST /api/renew/checkout/[tier]` — renewal session (dynamic by tier; `associate` replaces the old `checkout-am`)
- `GET  /api/renew/session-info` — lookup renewal checkout status
- `POST /api/renew/pd-log` — record PD entry
- `GET  /api/health` — Stripe + email probe (used by Cloudflare alerting worker)
- `GET  /api/get-prices` — return active Stripe prices for tiers
- `GET  /api/session-info` — checkout session lookup
- `GET  /api/debug-env` — env diagnostics (dev only)

## Quick start

1. Install dependencies: `npm install`
2. Copy env template: `cp .env.example .env`
3. Fill in env values (see [Environment](#environment) below)
4. Run locally: `npm run dev`
5. Run tests: `npm run test`

## Environment

### Stripe
- `STRIPE_SECRET_KEY` — secret key for the env (`sk_test_…` / `sk_live_…`)
- `STRIPE_WEBHOOK_SECRET` — webhook signing secret (required, even in `CHECKOUT_DRY_RUN`)
- `STRIPE_PRICE_PROFESSIONAL` — Pro tier price ID
- `STRIPE_PRICE_ASSOCIATE` — Associate tier price ID
- `STRIPE_PRICE_PROFESSIONAL_RENEWAL` — Pro renewal price ID
- `STRIPE_PRICE_ASSOCIATE_RENEWAL` — Associate renewal price ID

### Mailgun (transactional email)
- `MAILGUN_API_KEY` — private API key (`key-…`)
- `MAILGUN_DOMAIN` — verified sending domain (e.g. `mg.example.com`)
- `MAILGUN_FROM` — full From header (e.g. `Re:Member <no-reply@mg.example.com>`)

Ops runbook: `docs/runbooks/mailgun-setup.md`

### Google Workspace (Sheets, Drive, Docs)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — SA email
- `GOOGLE_SERVICE_ACCOUNT_KEY` — SA private key (PEM)
- `GOOGLE_WORKSPACE_IMPERSONATE_USER` — DWD subject (e.g. `it-admin@example.com`)
- `GOOGLE_SHEETS_ID` — `Professional Applications` spreadsheet
- `GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID` — parent folder for PM/AM Applications
- `GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID` — destination for auto-generated review Docs (falls back to applications folder)

Setup runbook: `docs/runbooks/google-workspace-domain-wide-delegation.md`

### App
- `PUBLIC_APP_URL` — public base URL for outbound email links (e.g. `https://subscribe.example.com`)
- `STAGING_PREFIX` — `testing-` on staging Fly only; isolates top-level Drive folder names
- `CHECKOUT_DRY_RUN` — `true` validates Stripe config without creating sessions (great for staging + key rotation)
- `SLACK_WEBHOOK_URL` — destination for health-check alerts

## Stripe webhook endpoints

- Staging (`remember`): `https://remember-staging.fly.dev/api/stripe-webhook`
- Production (`remember-production`): `https://subscribe.example.com/api/stripe-webhook`

If a payment succeeded while the webhook URL was wrong, correct it in Stripe and replay `checkout.session.completed` to backfill side effects.

## Architecture notes

- **Sheets-as-DB** — single source of truth for applicants, memberships, renewals, checkout log, email log. Cheap to operate, easy for volunteer admins to inspect and edit.
- **Drive-as-DMS** — uploaded documents land in per-applicant folders under `PM Applications` / `AM Applications`. Soft-delete via `deleted = "TRUE"` + Drive trash.
- **Two renewal paths** — Pro (`/renew/pro`) and Associate (`/renew/associate`) are independent payment-only pages. No resume token, no application storage. Renewal rows written to a separate `Renewals` sheet.
- **No Stripe Subscription for renewals** — one-time payment only. Stripe-hosted Payment Links would be simpler; `/renew/*` flow exists for pre-fill via URL params.
- **Per-applicant serialisation** — `apply.ts` + `upload-file.ts` use a `Map<string, Promise<void>>` keyed by applicantId to chain read-modify-write operations. Mirror this pattern in any new endpoint that mutates a single applicant.
- **Token-first resume** — `resume_token` is the primary applicant identifier; email is fallback only. Email gets header-injection-safe validation before use.
- **Health-check alerting** — Fly checks don't notify. Cloudflare Worker (`remember-health-alert`) cron pings `/api/health` and posts to Slack on failure.
