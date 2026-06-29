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
- [ ] Extract all competency IDs + labels into JSON (Phase L landed; option values still in TS)
- [ ] Extract declaration text into JSON
- [ ] Extract further-requirement question text into JSON
- [ ] Engineer-only contract: only types, validators, visibleWhen, column letters remain in TS

## Notes
- Spec approved state gates Phase N+ changes.
- Any new form added without a corresponding spec dir is a process violation; reference this spec from the new feature spec.