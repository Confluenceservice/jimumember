# Design — Form Schema System

> Spec ID: `012` · Type: cross-cutting
> Depends on: `000-platform-overview`, `014-tier-abstraction`

## Overview

Two-file contract per form: TypeScript for structure + validation, JSON for copy. Runtime in `src/lib/forms/runtime.ts` provides pure functions for loading, validating, mapping to Sheet rows, and hydrating from API responses.

## Architecture

```
{name}.ts                {name}.content.json
   │                          │
   └──► loadSchema() ────────►│
            │                  │
            ▼                  │
       validate(values) ◄──────┘
            │
            ▼
       toRow(values) ──► string[] ──► Sheets adapter
            │
            ▼
       mapApiResponseToValues(row) ──► form state
```

## Component Design

1. **`src/lib/forms/types.ts`** — TS interfaces (`FieldDefinition`, `FieldOption`, `Validator`, `BaseField`, `TextField`, `SelectField`, `CheckboxField`, `GroupField`, `RepeatableField`, `GridField`, `Step`, `FormSchema`, `SheetStorage`, `RowFactory`).
2. **`src/lib/forms/validators.ts`** — 11 validator factories. Each returns `{ name, validate(value, ctx) }`. Header-injection-safe `emailNZ`.
3. **`src/lib/forms/runtime.ts`** — `loadSchema(name)`, `validate(schema, values)`, `toRow(schema, values)`, `walkFields(schema)`, `mapApiResponseToValues(schema, response)`.
4. **`src/lib/forms/tiers.ts`** — Tier config (see spec `014`).
5. **Renderer** (`src/lib/forms/render/`) — Server-side Astro components: `FieldRenderer.astro`, `Step.astro`, `Form.astro`. Render schema-driven fields with content-supplied labels.
6. **Client runtime** (`src/lib/forms/client/`) — JS for repeatables, conditional visibility, autosave queue.

## Data Design

### FormSchema shape

```typescript
type FormSchema = {
  name: string;
  tier: TierSlug;
  steps: Step[];
  uploads?: UploadSpec[];
  storage: SheetStorage;
};

type Step = {
  id: string;
  title: string;       // pulled from content
  fields: FieldDefinition[];
};

type FieldDefinition = BaseField & (
  | TextField
  | SelectField
  | CheckboxField
  | GroupField
  | RepeatableField
  | GridField
  | FileField
);

type Validator =
  | { kind: 'required' }
  | { kind: 'email' }
  | { kind: 'phoneNZ' }
  | { kind: 'ynRadio' }              // 'yes' | 'no' | null
  | { kind: 'jsonArray' }
  | { kind: 'integer' }
  | { kind: 'minLength'; value: number }
  | { kind: 'maxLength'; value: number }
  | { kind: 'min'; value: number }
  | { kind: 'max'; value: number }
  | { kind: 'regex'; pattern: string }
  | { kind: 'conditional'; when: VisibleWhen };
```

### Content JSON shape

```json
{
  "title": "Application Form",
  "steps": [
    {
      "id": "about",
      "title": "About You",
      "fields": [
        { "id": "firstName", "label": "First name", "placeholder": "..." }
      ]
    }
  ],
  "options": {
    "ynRadio": { "yes": "Yes", "no": "No" },
    "competencies": {
      "effectiveCommunication": "Effective communication",
      "advocacyEmpowerment": "Advocacy & empowerment"
    }
  },
  "uploads": {
    "training": { "label": "Training certificates", "required": true, "multiple": true },
    "ethics":   { "label": "Code of Ethics (signed)", "required": true, "multiple": false }
  }
}
```

### Storage shape

```typescript
type SheetStorage = {
  spreadsheetId: string;        // env-resolved
  tabName: string;
  columnMap: Record<string, string>;  // field id → column letter
  rowFactory: (values: Record<string, unknown>) => string[];
};
```

## API Design

Form system has no HTTP surface — it's a library. The `toRow()` output is consumed by per-form API routes (`src/pages/api/.../apply.ts`, etc.).

## Testing Strategy

- `validators.test.ts` — 20 cases: header-injection safety, conditional validators, edge values.
- `runtime.test.ts` — 14 cases: schema loading, validation, required-field safety net, visibleWhen.
- `tiers.test.ts` — 6 cases: TIERS frozen, getLookupKey.
- Per-schema `{name}.test.ts` — 6–8 cases: field inventory, columnMap integrity, rowFactory round-trip.

Total: 282+ tests passing as of Phase M.

## Migration Plan

- Phase A–E plan landed: all 6 schemas + content JSONs in place.
- Phase J–L: Advanced apply fully schema-driven; doc types derived from `schema.uploads`.
- Phase N+ (planned): abstract sample data out of schemas entirely so non-eng can swap org copy via JSON only.

## Future Considerations

- Schema versioning: tag schemas with version, surface in Sheets header row.
- Schema-driven email templates (currently hard-coded in `email-sender.ts`).
- Visual form builder for non-engineers.