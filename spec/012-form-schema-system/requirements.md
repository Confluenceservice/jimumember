# Requirements — Form Schema System

> Spec ID: `012` · Type: cross-cutting · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `014-tier-abstraction`
> Referenced by: `001`, `002`, `005`, `006`, plus every future form spec

## Overview

Every form in Re:Member is data-driven via a two-file contract: a TypeScript schema defining structure + validation + storage mapping, and a JSON content file holding user-facing strings. Non-developers edit the JSON. Engineers own the TS. This split lets orgs rebrand form copy without touching logic.

## Functional Requirements

- **REQ-FS-001** Every form lives at `src/lib/forms/schemas/{name}.ts` + `src/lib/forms/schemas/{name}.content.json`. The TS exports `{ schema, content }`.
- **REQ-FS-002** Content editable by non-devs: labels, placeholders, help text, option labels, group labels. Engineering owns: field types, validators, visibleWhen predicates, column letters, row factories.
- **REQ-FS-003** Eleven validator kinds: `email`, `phoneNZ`, `ynRadio`, `jsonArray`, `integer`, `minLength`, `maxLength`, `min`, `max`, `regex`, `required`, `conditional`. Each is a factory returning `{ name, validate }`. Validators are pure functions, no I/O.
- **REQ-FS-004** Implicit-required safety net: `validate()` honours `field.required = true` regardless of whether `required` appears in the validators array. Schemas cannot accidentally make a required field skippable by omitting the validator.
- **REQ-FS-005** `toRow()` adapter: converts a form-values object into a positional Sheet row array using each field's `columnMap.letter`. Returns `string[]` matching the Sheet's column count.
- **REQ-FS-006** `walkFields()` traverses the schema tree (including groups, repeatables, grids) yielding every leaf field. `mapApiResponseToValues()` hydrates form state from an API response using the reverse of `toRow()`.
- **REQ-FS-007** Per-schema co-located test file `{name}.test.ts` validates: required-field safety net, column-map integrity, row-factory round-trip, visibleWhen predicates.
- **REQ-FS-008** Field types: `text`, `textarea`, `select`, `checkbox`, `radio`, `date`, `email`, `phone`, `number`, `repeatable`, `group`, `grid`, `file`, `signature`, `hidden`.
- **REQ-FS-009** Repeatable fields: rows can be added/removed client-side; the resulting array is serialised as JSON into a single Sheet column (e.g. `qualifications`, `experience`, `pdEntries`).
- **REQ-FS-010** Grid fields: a 2D layout of Y/N cells (e.g. 21 competencies). Column keys derived from the `options` map; row keys defined statically. Validation checks at least one row answered.
- **REQ-FS-011** `visibleWhen` predicates: a field can declare `visibleWhen: { field: "x", equals: "y" }` to be hidden until its dependency is satisfied. Hidden fields are excluded from `toRow()` output.
- **REQ-FS-012** Upload fields: special `file` type backed by `src/pages/api/.../upload-file` (per spec). Schema declares the doc-type enum; UI derives upload categories from schema.uploads.

## Non-Functional Requirements

- **NFR-FS-001** All schema files must compile under strict TypeScript.
- **NFR-FS-002** Schema content JSON must be valid JSON (no comments, no trailing commas). Hand-edit safe.
- **NFR-FS-003** `runtime.ts` operations are pure — no I/O, no Date.now(), no Math.random(). All randomness and time must be injected by the caller. This makes schemas deterministic in tests.

## Acceptance Criteria

1. A new form with no engineers can be added by creating `{name}.ts` + `{name}.content.json` + a `.test.ts`. No `.astro` or API changes required for simple data-collection forms.
2. Removing the `required` validator from a field with `required: true` does NOT make the field skippable.
3. `toRow()` output array length equals Sheet column count (no off-by-one).
4. Repeatable fields serialize as valid JSON parseable by `JSON.parse()`.
5. Grid field validation rejects empty rows (all cells blank).

## Out of Scope

- WYSIWYG form editor (schemas are hand-edited JSON/TS).
- Multi-language content (one locale per org).
- Schema migration tooling (Phase N+ planned; not shipped).

## Related

- `src/lib/forms/types.ts` — TS interface definitions
- `src/lib/forms/validators.ts` — 11 validator factories
- `src/lib/forms/runtime.ts` — loadSchema, validate, toRow, walkFields
- `docs/forms/composing-a-form.md` — non-dev editing guide (migrate into `000/design.md` per plan)
- `docs/forms/composing-a-tier.md` — tier config guide
- `.wolf/buglog.json` — bug-001 (email regex), bug-002 (visibleWhen), bug-004 (PD log minRows)