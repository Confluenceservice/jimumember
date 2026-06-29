# Design — Advanced Application

> Spec ID: `001` · Type: member-facing feature
> Depends on: `000-platform-overview`, `012-form-schema-system`, `014-tier-abstraction`

## Overview

8-step wizard rendered via schema-driven components. Form-schema system handles validation, autosave, and Sheet mapping. Token-first resume.

## Component Design

1. **`src/lib/forms/schemas/advancedApply.ts`** — `FormSchema` with 8 steps. `tier: 'advanced'`. `storage.spreadsheetId` env-resolved. `columnMap` maps each field id to column letter (B–O for form, P–AF for refs/declarations).
2. **`src/lib/forms/schemas/advancedApply.content.json`** — labels, placeholders, competency IDs, declaration text, upload labels.
3. **`src/pages/apply/advanced.astro`** — server-rendered shell + client runtime. Per-step component, sidebar progress, autosave queue.
4. **`src/pages/api/advanced/apply.ts`** — autosave handler. Token-first lookup, per-applicant write queue.
5. **`src/pages/api/advanced/upload-complete.ts`** — completion check + Stripe Checkout Session creation.

## Data Flow

```
User fills step 1
   │
   ▼
client autosave ─► POST /api/advanced/apply { firstName, lastName, email, ... }
   │
   ▼
handler: getApplicantByToken(token) OR createApplicantRow(initial)
   │
   ▼
toRow(schema, values) ─► string[] ─► Sheets API append/update
   │
   ▼
return { applicantId, token }
   │
   ▼
client stores token in window.__token__ + sessionStorage
```

### Completion → Checkout

```
User clicks "Proceed to Payment"
   │
   ▼
POST /api/advanced/upload-complete { token, applicantId }
   │
   ▼
validateCompletion(applicantId):
   ├─ required form fields filled?
   ├─ all 6 required doc categories ≥1 file?
   └─ yes → createCheckoutSession(applicant)
              │
              ▼
         return { url: 'https://checkout.stripe.com/...' }
```

## Storage

- Spreadsheet: `GOOGLE_SHEETS_SPREADSHEET_ID` env var.
- Tab name: `Advanced Applications` (configurable in schema).
- 47 columns A–AU (see `000-platform-overview/design.md` §Data Design).

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/advanced/apply?token=X` | Hydrate applicant state for resume |
| POST | `/api/advanced/apply` | Autosave form progress |
| POST | `/api/advanced/upload-complete` | Trigger checkout after completion gate |
| GET | `/api/advanced/resend-link?token=X` | Resend resume-link email |

## Error Codes

- `INVALID_TOKEN` — token not found
- `INCOMPLETE` — required form fields blank OR required doc categories empty
- `ALREADY_COMPLETED` — applicant already paid
- `CHECKOUT_ERROR` — Stripe API failure
- `MISSING_CONFIG` — STRIPE_SECRET_KEY missing

## Testing Strategy

- `src/pages/api/advanced/apply.test.ts` — autosave happy path + token validation + queue
- `src/pages/api/advanced/upload-complete.test.ts` — completion gate + Stripe session creation
- `src/lib/forms/schemas/advancedApply.test.ts` — schema integrity, columnMap, rowFactory, 21 competency keys
- `validators.test.ts` — covers all 11 validator factories

## Risks

- Large schema: 47 columns + 8 steps + 21 competencies + 8 declarations = high change surface. Schema-abstraction (Phase N+) will reduce this.
- Repeating fields race: client queue + server queue handle this.

## Migration Plan

- Phase J1–J3 landed: form structure + client runtime + upload derived from schema.
- Phase N+ (planned): abstract sample data out of schemas.