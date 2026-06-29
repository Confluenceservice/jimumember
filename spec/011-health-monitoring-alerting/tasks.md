# Tasks — Health Monitoring & Alerting

> Spec ID: `011` · Type: system feature
> Status: backfilled. Approval pending first health-check change.

## Phase 1: Health Endpoint
- [x] `GET /api/health` returns structured status
- [x] Stripe probe (prices.list limit 1)
- [x] Email probe (config presence)
- [x] Renewal price probe (env-var resolution per tier)
- [x] Always returns 200 (failures as `down` not 500)

## Phase 2: Cloudflare Worker
- [x] `.run/health-alert-worker/` Wrangler config
- [x] Hourly cron trigger
- [x] Fetch `/api/health` → Slack post if non-ok
- [x] Staging vs prod distinguished in alert message

## Phase 3: Env Vars
- [x] `REMEMBER_HEALTH_ALERT_URL` repo var
- [x] `SLACK_WEBHOOK_URL` worker secret
- [x] `REMEMBER_HEALTH_URL` worker var (per environment)

## Phase 4: Future
- [ ] Synthetic Stripe webhook test
- [ ] Per-route latency tracking (Sentry)
- [ ] Public status page

## Notes
- Health endpoint must be fast (<2s). Stripe list limited to 1.
- Worker fetch failure itself is logged in Cloudflare dashboard (visible without Slack).