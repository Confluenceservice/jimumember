# Tasks — Form Schema System

> Spec ID: `012` · Type: cross-cutting
> Status: backfilled. Approval pending first form change.

## Phase 1: Foundations (Phase A–F)
- [x] `types.ts` — TS interfaces for all field types
- [x] `validators.ts` — 11 validator factories, 20 test cases
- [x] `runtime.ts` — loadSchema, validate, toRow, walkFields, mapApiResponseToValues
- [x] `tiers.ts` — TIERS frozen config
- [x] `FieldRenderer.astro` + `Step.astro` + `Form.astro` server components
- [x] `client/` runtime — repeatables, conditional visibility, autosave queue
- [x] Implicit-required safety net (validate() honours field.required)

## Phase 2: Form Migrations (Phase B–I)
- [x] `renewBasic` schema + content.json
- [x] `renewAdvanced` schema + content.json
- [x] `pdLog` schema + content.json (synthetic single-entry + per-entry validation)
- [x] `basicApply` schema + content.json
- [x] `advancedApply` schema + content.json (8-step wizard, 47-col storage)
- [x] `example.memberSurvey` template

## Phase 3: Schema-Driven Routes (Phase G–M)
- [x] Dynamic `/api/renew/checkout/[tier].ts` reads tier from URL
- [x] Dynamic `[tier].astro` for renewals
- [x] Advanced apply autosave wired to schema
- [x] Doc-type derivation from `schema.uploads`
- [x] Tier rename: professional→advanced, associate→basic; storage values pm→adv, am→basic

## Phase 4: Sample Data Abstraction (Phase N+ planned)
- [x] Extract all competency IDs + labels into JSON — done in Phase L: `COMPETENCY_IDS` is derived via `Object.keys(content.steps.competencies.fields.coreCompetencies.options)`; all 21 options live in `advancedApply.content.json` (verified 2026-07-03)
- [x] Extract declaration text into JSON — declaration labels live under `content.steps.declarations.fields.*`; TS holds only field names + contentKeys (verified 2026-07-03)
- [x] Extract further-requirement question text into JSON — `FURTHER_REQUIREMENT_IDS` derived from the content JSON's options map, same pattern as competencies (verified 2026-07-03)
- [ ] Engineer-only contract: only types, validators, visibleWhen, column letters remain in TS — REMAINING: the 7 upload doc-type labels (`advancedApply.ts` `uploads.docTypes[].label`, e.g. "Certificates of training") are still TS-side; move to content.json to finish

## Notes
- Spec approved state gates Phase N+ changes.
- Any new form added without a corresponding spec dir is a process violation; reference this spec from the new feature spec.