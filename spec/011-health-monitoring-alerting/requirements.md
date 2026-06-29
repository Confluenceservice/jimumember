# Requirements — Health Monitoring & Alerting

> Spec ID: `011` · Type: system feature · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `007-stripe-checkout-flow`, `009-email-notifications`, `015-environment-configuration`
> Source today: `/api/health` + `.run/health-alert-worker/` (Cloudflare Worker)

## Overview

`/api/health` probes Stripe + Mailgun + renewal price resolution per tier. Cloudflare Worker cron posts failures to Slack. Two-stage: app health endpoint → external cron alerting.

## Functional Requirements

- **REQ-HM-001** `GET /api/health` returns overall status + per-subsystem status. No auth (public endpoint).
- **REQ-HM-002** Subsystems probed:
  - **Stripe**: `stripe.prices.list({ limit: 1 })` — confirms API key works
  - **Email**: presence of `MAILGUN_API_KEY` + `MAILGUN_DOMAIN` + `MAILGUN_FROM`
  - **Renewal prices**: `env.stripe.price(tier, 'renewal')` resolves for both tiers
- **REQ-HM-003** Status values: `ok` (all green), `degraded` (some non-critical subsystems down), `down` (critical subsystem down).
- **REQ-HM-004** Response shape:
  ```json
  {
    "status": "ok",
    "stripe": "ok",
    "email": "ok",
    "renewalPrices": { "basic": "ok", "advanced": "ok" },
    "timestamp": "2026-06-29T12:34:56Z"
  }
  ```
- **REQ-HM-005** Cloudflare Worker (`health-alert-worker`) runs on cron schedule (e.g. hourly), calls `/api/health`, posts to Slack webhook if `status != 'ok'`.
- **REQ-HM-006** Slack message includes: status, failing subsystems, timestamp, environment (staging/prod via `STAGING_PREFIX`).

## Non-Functional Requirements

- **NFR-HM-001** Health endpoint fast (<2s even when subsystems down). Stripe list limited to 1.
- **NFR-HM-002** Health endpoint never throws; failures reported as `down` not 500.

## Acceptance Criteria

1. All env vars set + Stripe reachable → `status: "ok"`.
2. `MAILGUN_API_KEY` missing → `status: "degraded"`, `email: "down"`.
3. `STRIPE_SECRET_KEY` missing → `status: "down"`.
4. Cloudflare Worker cron posts to Slack when `/api/health` returns non-ok.
5. Slack message distinguishes staging vs production.

## Out of Scope

- Synthetic monitoring (Stripe webhook test events).
- Per-route latency tracking (covered by Sentry).
- Uptime dashboard.

## Related

- `src/pages/api/health.ts` — endpoint
- `.run/health-alert-worker/` — Cloudflare Worker
- `REMEMBER_HEALTH_ALERT_URL` repo var (worker URL)
- Spec `015` — env vars