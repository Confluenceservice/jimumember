# Design — Membership Renewal

> Spec ID: `005` · Type: member-facing feature
> Depends on: `000-platform-overview`, `012-form-schema-system`, `014-tier-abstraction`, `015-environment-configuration`

## Overview

Schema-driven renewal form per tier. Dynamic `/renew/[tier].astro` renders the right schema. Dynamic `/api/renew/checkout/[tier].ts` handles submission. Renewals share one Sheet tab.

## Component Design

1. **`src/lib/forms/schemas/renewBasic.ts`** — single step: firstName, lastName, email, year.
2. **`src/lib/forms/schemas/renewAdvanced.ts`** — single step: firstName, lastName, email, phone, year.
3. **`src/pages/renew/[tier].astro`** — dynamic route, loads schema by tier slug.
4. **`src/pages/api/renew/checkout/[tier].ts`** — dynamic handler, appends Renewals row, creates Stripe session.
5. **`src/lib/renewal-sheet.ts`** — `appendRenewal()`, `markRenewalPaid()`, retry-with-jitter.

## Data Flow

```
User submits renewal form
   │
   ▼
POST /api/renew/checkout/advanced { firstName, lastName, email, phone, year }
   │
   ▼
validate(schema, values) ─► errors? return 400
   │
   ▼
appendRenewal({ tier: 'adv', firstName, ..., renewal_id: UUID, payment_status: 'pending' })
   │
   ▼
getLookupKey('advanced', 'renewal') → 'STRIPE_PRICE_2_RENEWAL'
   │
   ▼
stripe.checkout.sessions.create({
   mode: 'payment',
   line_items: [{ price: env.stripe.price('advanced', 'renewal'), quantity: 1 }],
   metadata: { flow: 'renewal', plan: 'advanced', tier: 'adv', renewal_id, renewal_year: year }
})
   │
   ▼
return { url: 'https://checkout.stripe.com/...' }
```

### Webhook completion

```
Stripe webhook → checkout.session.completed (metadata.flow === 'renewal')
   │
   ▼
extract renewal_id from metadata
   │
   ▼
markRenewalPaid(renewal_id, amountPaidCents, stripeSession)
   │
   ▼
if tier === 'adv': sendRenewalPdLogLink(...)
sendRenewalAdminNotification(...)
```

## Storage

### Renewals sheet (14 cols, A–N)

```
A renewal_id        UUID
B tier              'basic' | 'adv'
C renewal_year      form
D first_name        form
E last_name         form
F email             form
G phone             form (advanced only)
H pd_entries        JSON array (managed, empty on submit; populated by spec 006)
I amount_paid_cents managed (set by webhook)
J currency          managed (ISO 4217)
K payment_status    'pending' | 'paid'
L stripe_session    managed
M created_at        ISO 8601
N paid_at           ISO 8601 (set by webhook)
```

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/renew/checkout/[tier]` | Submit renewal, get Stripe URL |
| GET | `/api/renew/session-info?session_id=X` | Post-checkout confirmation |

## Error Codes

- `INVALID_TOKEN` — token not found (legacy path)
- `MISSING_CONFIG` — env vars missing
- `CHECKOUT_ERROR` — Stripe failure

## Testing Strategy

- `renewBasic.test.ts`, `renewAdvanced.test.ts` — schema integrity
- `[tier].test.ts` — checkout handler, Stripe mock, Renewals append
- Webhook completion flow — covered in spec `008`

## Migration Plan

- Phase B landed: renewBasic schema + dynamic route.
- Phase G landed: renewAdvanced with phone + pdEntries passthrough.

## Future Considerations

- Auto-renewal subscriptions.
- Tier upgrade/downgrade mid-year.
- Multi-year renewal.