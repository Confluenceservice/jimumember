# Design — Environment Configuration

> Spec ID: `015` · Type: cross-cutting
> Depends on: `000-platform-overview`, `014-tier-abstraction`

## Overview

All config via env vars. `STAGING_PREFIX` is the only routing-affecting variable; others are pure values read at request time. Tier-aware env-var lookup bridges `STRIPE_PRICE_N` numeric keys to tier slugs.

## Component Design

### Env-var loader

Centralised in `src/lib/env.ts`. Exports typed accessors:

```typescript
export const env = {
  stripe: {
    secretKey: () => require('STRIPE_SECRET_KEY'),
    webhookSecret: () => require('STRIPE_WEBHOOK_SECRET'),
    price: (tier: TierSlug, kind: 'application' | 'renewal') => {
      const key = getLookupKey(tier, kind);
      const value = process.env[withPrefix(key)];
      if (!value) throw new MissingConfigError(key);
      return value;
    },
  },
  google: { ... },
  mailgun: { ... },
  org: { ... },
  isStaging: () => Boolean(process.env.STAGING_PREFIX),
  isDryRun: () => parseBool(process.env.CHECKOUT_DRY_RUN),
};
```

### Tier-aware lookup key

```typescript
export function getLookupKey(tier: TierSlug, kind: 'application' | 'renewal'): string {
  const tierIndex = tier === 'basic' ? 1 : 2;  // extends on tier add
  return kind === 'renewal' ? `STRIPE_PRICE_${tierIndex}_RENEWAL` : `STRIPE_PRICE_${tierIndex}`;
}

function withPrefix(key: string): string {
  return env.isStaging() ? `${process.env.STAGING_PREFIX}${key}` : key;
}
```

## Data Flow

```
checkout request arrives
   │
   ▼
isStaging()?  ──yes──► env.STAGING_PREFIX
   │                       │
   │                       ▼
   │              withPrefix("STRIPE_PRICE_2") → "STRIPE_STAGING_PRICE_2"
   │                       │
   ▼                       ▼
price('advanced', 'application')  ◄──── env.stripe.price(...)
   │
   ▼
stripe.checkout.sessions.create({ line_items: [{ price: 'price_xxx', ... }] })
```

## Testing Strategy

- Env-var loader unit tests with stubbed `process.env`.
- `getLookupKey` matrix test for all tier × kind combinations.
- `withPrefix` test for staging vs production.
- Dry-run flag parsing test (truthy variants).

## Migration Plan

None — env-var schema is stable. Adding a new var = adding a line to `.env.example` + reading it via `env.*` accessor.

## Future Considerations

- Per-org secrets manager integration (1Password, Vault).
- Tier-prefixed sheet IDs (today: single spreadsheet, multiple tabs).
- Feature flags via env var (`FEATURE_PD_LOG=true`).