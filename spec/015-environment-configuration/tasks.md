# Tasks — Environment Configuration

> Spec ID: `015` · Type: cross-cutting
> Status: backfilled. Approval pending first env-var change.

## Phase 1: Foundation
- [x] `.env.example` template covers all 5 categories
- [x] `src/lib/env.ts` typed accessors with MissingConfigError
- [x] Tier-aware `getLookupKey()` + `withPrefix()`
- [x] Dry-run flag parsing (4 truthy variants)
- [x] Sentry DSN optional observability

## Phase 2: Health Check Surfacing
- [x] `/api/health` reports missing-config per subsystem
- [x] Cloudflare Worker cron posts to Slack on degraded/down
- [x] Email subsystem reports `MAILGUN_API_KEY` missing distinctly from Mailgun API error

## Phase 3: Runbook Integration
- [x] `docs/runbooks/fly-app-bootstrap.md` — Fly secrets setup
- [x] `docs/runbooks/github-actions-bootstrap.md` — repo secrets setup
- [x] `docs/runbooks/stripe-first-products.md` — STRIPE_PRICE_* creation
- [x] `docs/runbooks/mailgun-setup.md` — MAILGUN_* setup
- [x] `docs/runbooks/google-workspace-domain-wide-delegation.md` — GOOGLE_* setup

## Phase 4: Future
- [ ] Per-org secrets manager (multi-tenant support)
- [ ] Feature flag env-var pattern (`FEATURE_X=true`)

## Notes
- Any new env var must be added to `.env.example` and to `src/lib/env.ts` typed accessor.
- Secrets must never appear in logs; pino redact list covers `*KEY*`, `*SECRET*`, `*TOKEN*`.