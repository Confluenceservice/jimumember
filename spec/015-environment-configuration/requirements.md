# Requirements — Environment Configuration

> Spec ID: `015` · Type: cross-cutting · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `014-tier-abstraction`
> Referenced by: `007`, `008`, `009`, `013`, every deploy + runbook

## Overview

Re:Member is configured entirely via environment variables. No `.env` checked in. No config file at runtime. Every Fly secret maps to one of five categories: Stripe, Google Workspace, Mailgun, org identity, deployment tenancy.

## Functional Requirements

- **REQ-EC-001** Org identity (`ORG_NAME`, `SUPPORT_EMAIL`, `ADMIN_EMAIL`, `PUBLIC_ORG_URL`, `PUBLIC_APP_URL`) interpolated into every email subject/body and admin notification. Single source of truth for branding.
- **REQ-EC-002** Stripe env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_1`, `STRIPE_PRICE_2`, `STRIPE_PRICE_1_RENEWAL`, `STRIPE_PRICE_2_RENEWAL`, `CHECKOUT_DRY_RUN`.
- **REQ-EC-003** Google Workspace env vars: `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY`, `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_WORKSPACE_IMPERSONATE_USER`, `GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID`, `GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID`.
- **REQ-EC-004** Mailgun env vars: `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`, optional `MAILGUN_REGION` (US default; EU base URL when set).
- **REQ-EC-005** Localisation: `RENEWAL_ANCHOR_MONTH` (default 7), `RENEWAL_ANCHOR_DAY` (default 1). Determines membership-year rollover.
- **REQ-EC-006** Deployment tenancy: `STAGING_PREFIX` (e.g. empty for prod, `STAGING_` for staging). When set, all Stripe + Sheets env vars are looked up with the prefix prepended. Lets one Stripe account serve both staging + production with isolated products.
- **REQ-EC-007** Observability: `SENTRY_DSN` (optional). When set, all logger calls post to Sentry.
- **REQ-EC-008** `CHECKOUT_DRY_RUN` accepted as `true`/`1`/`yes`/`on` (case-insensitive). When truthy, checkout endpoints validate config without hitting Stripe. `STRIPE_WEBHOOK_SECRET` still required.

## Non-Functional Requirements

- **NFR-EC-001** Missing env vars fail loud at startup with the variable name in the error message.
- **NFR-EC-002** Secrets never logged. `pino` logger redacts keys matching `*KEY*`, `*SECRET*`, `*TOKEN*`.
- **NFR-EC-003** `STAGING_PREFIX` is the only env var that affects routing logic. Other vars are pure values.

## Acceptance Criteria

1. Renaming `STRIPE_PRICE_1` to `STRIPE_PRICE_2` causes health check to fail with the variable name in error.
2. `STAGING_PREFIX=STAGING_` causes `getLookupKey('basic', 'application')` to return `STRIPE_STAGING_PRICE_1` in staging.
3. `CHECKOUT_DRY_RUN=true`: "Proceed to Payment" returns `{dryRun: true, stripeKeysValidated: true}` without network call.
4. Health endpoint reports `email: "down"` when `MAILGUN_API_KEY` is missing.

## Out of Scope

- Per-request config overrides.
- Runtime config reload (restart required for env-var changes).
- Secrets management beyond Fly secrets + GitHub repo secrets.

## Related

- `.env.example` — template
- `docs/runbooks/fly-app-bootstrap.md` — Fly secrets setup
- `docs/runbooks/github-actions-bootstrap.md` — repo secrets setup