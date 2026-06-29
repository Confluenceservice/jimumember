# Design — Health Monitoring & Alerting

> Spec ID: `011` · Type: system feature
> Depends on: `000-platform-overview`, `007-stripe-checkout-flow`, `009-email-notifications`, `015-environment-configuration`

## Overview

Two-stage: app `/api/health` endpoint + external Cloudflare Worker cron that posts to Slack.

## Component Design

1. **`src/pages/api/health.ts`** — endpoint. Probes Stripe, Mailgun config, renewal prices. Always returns 200 with structured JSON.
2. **`.run/health-alert-worker/wrangler.toml`** — Cloudflare Worker config.
3. **`.run/health-alert-worker/src/index.ts`** — Worker code. Cron trigger → fetch `/api/health` → Slack post if non-ok.

## Health Endpoint Implementation

```typescript
export async function GET() {
  const result = {
    status: 'ok' as 'ok' | 'degraded' | 'down',
    stripe: 'ok' as 'ok' | 'down',
    email: 'ok' as 'ok' | 'down',
    renewalPrices: { basic: 'ok' as 'ok' | 'down', advanced: 'ok' as 'ok' | 'down' },
    timestamp: new Date().toISOString(),
  };

  // Stripe probe
  try {
    await stripe.prices.list({ limit: 1 });
  } catch (e) {
    result.stripe = 'down';
    result.status = 'down';
  }

  // Email probe (config presence only — no API call)
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN || !process.env.MAILGUN_FROM) {
    result.email = 'down';
    if (result.status === 'ok') result.status = 'degraded';
  }

  // Renewal prices (env-var resolution)
  try { env.stripe.price('basic', 'renewal'); } catch { result.renewalPrices.basic = 'down'; if (result.status === 'ok') result.status = 'degraded'; }
  try { env.stripe.price('advanced', 'renewal'); } catch { result.renewalPrices.advanced = 'down'; if (result.status === 'ok') result.status = 'degraded'; }

  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

## Cloudflare Worker

```typescript
// .run/health-alert-worker/src/index.ts
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    const res = await fetch(env.REMEMBER_HEALTH_URL);
    const data = await res.json();
    if (data.status !== 'ok') {
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 Health alert (${env.STAGING_PREFIX ? 'staging' : 'production'}): ${data.status}\n${JSON.stringify(data, null, 2)}`,
        }),
      });
    }
  },
};
```

## Cron Schedule

Hourly via `wrangler.toml`:

```toml
[triggers]
crons = ["0 * * * *"]
```

## Testing Strategy

- `health.test.ts` — each subsystem down → correct status propagation
- Worker unit test with mocked fetch

## Risks

- Slack webhook outage: alerts lost. Mitigation: alerts also visible in Cloudflare Worker logs.
- `/api/health` endpoint itself down: Worker can't reach it, no alert sent. Mitigation: Worker logs the fetch failure (visible in Cloudflare dashboard).

## Future Considerations

- Per-route latency tracking
- Synthetic Stripe webhook test
- Status page (public)