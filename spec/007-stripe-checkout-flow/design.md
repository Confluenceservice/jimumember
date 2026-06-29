# Design — Stripe Checkout Flow

> Spec ID: `007` · Type: system feature
> Depends on: `000-platform-overview`, `014-tier-abstraction`, `015-environment-configuration`

## Overview

Single `createCheckoutSession()` abstraction with per-flow metadata. Retry-with-backoff client-side. Dry-run mode for safe config validation.

## Component Design

1. **`src/lib/stripe.ts`** — `createCheckoutSession({ flow, plan, tier, ... })`. Returns Stripe session or throws typed error.
2. **`src/pages/api/advanced/upload-complete.ts`** — completion gate + checkout creation.
3. **`src/pages/api/create-checkout-session.ts`** — basic application flow.
4. **`src/pages/api/renew/checkout/[tier].ts`** — renewal flow.

## Checkout Session Shape

### Application (Option C)

```typescript
{
  mode: 'payment',  // first-term one-time
  customer_email: applicant.email,
  line_items: [{ price: env.stripe.price(tier, 'application'), quantity: 1 }],
  success_url: `${PUBLIC_APP_URL}/apply/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${PUBLIC_APP_URL}/apply/cancelled`,
  metadata: {
    flow: 'option_c',
    plan: 'basic' | 'advanced',
    applicant_id: applicantId,
    recurring_price_id: env.stripe.price(tier, 'renewal'),
    next_july1_epoch: nextJuly1().getTime() / 1000,
  },
  subscription_data: {
    trial_end: nextJuly1(),
    metadata: { plan: tier },
  },
}
```

### Renewal

```typescript
{
  mode: 'payment',
  customer_email: renewal.email,
  line_items: [{ price: env.stripe.price(tier, 'renewal'), quantity: 1 }],
  success_url: `${PUBLIC_APP_URL}/renew/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${PUBLIC_APP_URL}/renew/cancelled`,
  metadata: {
    flow: 'renewal',
    plan: tier,
    tier: TIERS[tier].storageValue,
    renewal_id,
    renewal_year,
  },
}
```

## Retry Strategy (client-side)

```typescript
async function goToPayment(retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch('/api/advanced/upload-complete', { ... });
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        showWaitMessage(retryAfter);
        return;
      }
      if (res.ok) return res.json();
      if (res.status === 400 || res.status === 500) {
        const err = await res.json();
        showError(err.code);  // not retryable
        return;
      }
      // 502/503/504 or network: retry
      await sleep(1000 * 2 ** attempt);
    } catch (e) {
      // network: retry
      await sleep(1000 * 2 ** attempt);
    }
  }
  showError('CHECKOUT_ERROR', { retryable: true });
}
```

## Error Codes

- `INVALID_TOKEN` — token missing or invalid
- `INCOMPLETE` — completion gate failed
- `ALREADY_COMPLETED` — applicant already paid
- `CHECKOUT_ERROR` — Stripe API failure (retryable flag varies)
- `MISSING_CONFIG` — env var missing

## Testing Strategy

- Per-flow handler test with Stripe mock
- Retry-with-backoff simulation
- Dry-run mode test (no network call)
- 429 handling test

## Risks

- Stripe API downtime: retries mitigate but don't eliminate. Health check reports degraded.
- Price ID mismatches between env vars and Stripe Dashboard: validated at session creation time.

## Future Considerations

- Stripe Tax integration (auto-calc tax)
- Multi-currency support (today: single currency per org)