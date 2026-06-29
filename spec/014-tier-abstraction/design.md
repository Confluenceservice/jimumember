# Design — Tier Abstraction

> Spec ID: `014` · Type: cross-cutting
> Depends on: `000-platform-overview`

## Overview

Single frozen config object + type auto-extension. Three layers of defence: TS types prevent invalid tier names, runtime config prevents silent fallbacks, storage-value decoupling prevents rename-induced data loss.

## Component Design

### `src/lib/forms/tiers.ts`

```typescript
export const TIERS = {
  basic: {
    slug: 'basic',
    label: 'Basic',
    storageValue: 'basic',
    description: 'Associate-level membership',
  },
  advanced: {
    slug: 'advanced',
    label: 'Advanced',
    storageValue: 'adv',
    description: 'Professional-level membership',
  },
} as const;

export type TierSlug = keyof typeof TIERS;
export type MembershipPlan = TierSlug;
export class UnknownTierError extends Error { ... }

export function getTier(slug: string): typeof TIERS[TierSlug] { ... }
export function listTiers(): Array<typeof TIERS[TierSlug]> { ... }
export function tierLabelFor(slug: TierSlug | string): string { ... }
export function getLookupKey(tier: TierSlug, kind: 'application' | 'renewal'): string { ... }
```

### Type extensions

```typescript
type TierSlug = 'basic' | 'advanced';          // auto-extends on TIERS change
type TierStorageValue = typeof TIERS[TierSlug]['storageValue'];
type RenewalInput = { tier: TierSlug; ... };   // no string fallthrough
```

## Data Flow

```
URL: /renew/advanced
   │
   ▼
[tier].astro → getTier('advanced') → TIERS.advanced
   │
   ▼
schema = renewAdvanced (tier: 'advanced')
   │
   ▼
POST /api/renew/checkout/advanced
   │
   ▼
getLookupKey('advanced', 'application') → 'STRIPE_PRICE_2'
   │
   ▼
Stripe checkout session created with metadata.tier = 'adv'
```

## Risks

- Adding tiers requires Sheet schema additions. Each tier has its own column layout in Renewals sheet (or shares one — currently they share).
- Env-var name `STRIPE_PRICE_{N}` doesn't reflect tier slug; relying on `getLookupKey()` to bridge.

## Future Considerations

- Per-tier pricing strategies beyond env-var lookup (dynamic pricing, regional).
- Per-tier feature flags.
- Tier upgrade/downgrade flow (not in scope today).