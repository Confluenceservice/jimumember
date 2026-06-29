# Tasks — Advanced Application

> Spec ID: `001` · Type: member-facing feature
> Status: backfilled. Approval pending first advanced-apply change.

## Phase 1: Schema System (Phase A–F)
- [x] `types.ts` interfaces (text, repeatable, grid, etc.)
- [x] 11 validator factories
- [x] `runtime.ts` loadSchema, validate, toRow
- [x] FieldRenderer, Step, Form Astro components

## Phase 2: Advanced Apply Schema (Phase J1–J3)
- [x] `advancedApply.ts` schema: 8 steps, 21 competencies, 8 declarations, 6 doc types
- [x] `advancedApply.content.json` competency IDs + labels + declaration text
- [x] Form runtime wired to schema
- [x] Doc-type derivation from `schema.uploads`
- [x] Client autosave queue
- [x] Server-side per-applicant write queue
- [x] Identity fields (firstName, lastName, phone, email) persisted with form data

## Phase 3: API Routes
- [x] GET `/api/advanced/apply?token=` returns applicantId
- [x] POST `/api/advanced/apply` autosave
- [x] POST `/api/advanced/upload-complete` checkout trigger
- [x] GET `/api/advanced/resend-link` resume email resend
- [x] Completion gate: required form fields + 6 required doc categories ≥1 file
- [x] Error code taxonomy (INVALID_TOKEN, INCOMPLETE, ALREADY_COMPLETED, CHECKOUT_ERROR, MISSING_CONFIG)

## Phase 4: Resilience (Phase J2–J3)
- [x] Retry with exponential backoff (1s/2s/4s) for network + 502/503/504
- [x] Rate-limit handling via Retry-After header
- [x] Typed error responses (code + retryable)
- [x] Inline error banner (not dismissable alert)
- [x] Token persistence across retries

## Phase 5: Schema Abstraction (Phase N+ planned)
- [ ] Extract competency IDs + labels into pure JSON (Phase L landed for labels)
- [ ] Extract declaration text into JSON
- [ ] Extract further-requirement questions into JSON
- [ ] Engineer-only contract enforced via TS lint rule

## Phase 6: Bug Fixes
- [x] Bug-002: visibleWhen excludes fields from toRow output
- [ ] Bug-001: email regex edge cases (header injection safety landed)

## Notes
- Schema is the contract. Test suite (`advancedApply.test.ts`) is the safety net.
- Any change to REQ-AA-001 (8 steps) or REQ-AA-006 (21 competencies) requires spec re-approval.