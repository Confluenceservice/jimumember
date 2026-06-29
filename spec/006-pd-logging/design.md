# Design — PD Logging

> Spec ID: `006` · Type: member-facing feature
> Depends on: `000-platform-overview`, `005-membership-renewal`, `012-form-schema-system`

## Overview

Schema-driven repeatable form. Synthetic single-entry schema is defined; runtime validates each entry independently. JSON-serialised into Renewals H column.

## Component Design

1. **`src/lib/forms/schemas/pdLog.ts`** — single-entry schema: dateCompleted, activity, totalHours, provider.
2. **`src/pages/renew/pd-log.astro`** — server-rendered form with client-side repeatable handling.
3. **`src/pages/api/renew/pd-log.ts`** — GET (read current entries), POST (validate + write).
4. **`src/lib/renewal-sheet.ts`** — `updateRenewalPdEntries(renewalId, entries)`.

## Synthetic Schema Pattern

```typescript
// pdLog.ts exports a single-entry schema; handler instantiates per-entry validation
const entrySchema: FormSchema = { name: 'pdEntry', tier: 'advanced', steps: [...] };

// handler
const errors = entries.flatMap((entry, i) => {
  const entryErrors = validate(entrySchema, entry);
  return entryErrors.map(e => ({ index: i, ...e }));
});
if (errors.length) return 400 with errors;
```

## Data Flow

### GET

```
GET /api/renew/pd-log?token=X
   │
   ▼
getRenewalById(X) → row
   │
   ▼
parse JSON from column H → entries[]
   │
   ▼
return { entries }
```

### POST

```
POST /api/renew/pd-log { token, entries, dryRun? }
   │
   ▼
if dryRun: validate only, return { success: true, dryRun: true }
   │
   ▼
for each entry: validate(entrySchema, entry) → errors
   │
   ▼
if any errors: return 400 with all errors per index
   │
   ▼
updateRenewalPdEntries(token, entries) → JSON.stringify → column H
   │
   ▼
return { success: true, renewalId: token }
```

## Storage

- Renewals column H: JSON array of PD entries.
- No separate sheet; entries live with the renewal record.

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/renew/pd-log?token=X` | Load current entries |
| POST | `/api/renew/pd-log` | Save entries |

## Error Codes

- `INVALID_TOKEN` — renewal not found
- `INVALID_ENTRY` — validation failed (with per-index error details)
- `DRY_RUN` — dry-run mode, no write

## Testing Strategy

- `pdLog.test.ts` — synthetic schema integrity
- `pd-log.test.ts` — GET/POST handler, per-entry validation, dry-run

## Risks

- JSON corruption: if a manual Sheets edit corrupts column H, the form will fail to render. Mitigation: try/catch + display empty form + log error.

## Future Considerations

- Min rows enforcement (bug-004)
- PD hours total display
- Export to CSV for admin reporting