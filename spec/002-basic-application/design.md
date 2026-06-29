# Design — Basic Application

> Spec ID: `002` · Type: member-facing feature
> Depends on: `000-platform-overview`, `012-form-schema-system`, `014-tier-abstraction`

## Overview

Single-page form, schema-driven via `basicApply.ts`. Submit-then-pay flow. No resume by token (different from advanced).

## Component Design

1. **`src/lib/forms/schemas/basicApply.ts`** — FormSchema with 1 step. 13 form fields + 3 managed (submitted_at, application_id, checkout_status).
2. **`src/pages/apply/basic.astro`** — single-page form.
3. **`src/pages/api/apply.ts`** — POST handler. Validates via schema, appends to sheet, creates Stripe session, returns checkout URL.
4. **`src/pages/api/create-checkout-session.ts`** — Stripe Checkout Session creation.

## Data Flow

```
User submits form
   │
   ▼
POST /api/apply { firstName, ..., signature }
   │
   ▼
validate(schema, values) ─► errors? return 400
   │
   ▼
appendBasicApplication(values) ─► sheet row, application_id = UUID
   │
   ▼
createCheckoutSession({ plan: 'basic', application_id, ... })
   │
   ▼
return { url: 'https://checkout.stripe.com/...' }
   │
   ▼
Browser redirects to Stripe
```

### Webhook completion

```
Stripe webhook → checkout.session.completed
   │
   ▼
lookup application_id from metadata
   │
   ▼
update Basic Applications row: checkout_status = "paid"
   │
   ▼
createReviewDoc(application)
sendConfirmation(application)
sendAdminNotification(application)
```

## Storage

- Spreadsheet: same `GOOGLE_SHEETS_SPREADSHEET_ID`.
- Tab name: `Basic Applications`.
- 16 columns A–P (3 managed + 13 form-derived).

## Error Codes

- `INVALID_INPUT` — validation failed
- `CHECKOUT_ERROR` — Stripe failure
- `MISSING_CONFIG` — env vars missing

## Testing Strategy

- `basicApply.test.ts` — schema integrity, columnMap
- `api/apply.test.ts` — POST handler, validation, append, checkout creation
- `api/stripe-webhook.test.ts` — basic completion flow

## Migration Plan

- Phase I landed: schema-driven basic apply. Old `apply.astro` (326 lines) replaced with schema-driven version (127 lines).

## Future Considerations

- Resume by token for basic (currently no resume — single submit only).
- Multi-step variant if basic form grows beyond single page.