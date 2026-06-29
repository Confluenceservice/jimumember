# Tasks — Basic Application

> Spec ID: `002` · Type: member-facing feature
> Status: backfilled. Approval pending first basic-apply change.

## Phase 1: Schema Migration (Phase I)
- [x] `basicApply.ts` schema with 13 form fields
- [x] `basicApply.content.json` labels + options
- [x] Form rendering via FieldRenderer
- [x] `validateTier()` for tier validation
- [x] `appendBasicApplication()` named-arg pattern

## Phase 2: API + Checkout
- [x] POST `/api/apply` handler
- [x] Stripe Checkout Session creation
- [x] Webhook completion → sheet `paid` flag
- [x] Review doc generation
- [x] Confirmation + admin notification emails

## Phase 3: Bug Fixes
- [x] Replace old `apply.astro` (326 → 127 lines)

## Phase 4: Future
- [ ] Resume by token (currently no resume — single submit only)
- [ ] Multi-step variant if form grows

## Notes
- Single-page by design. Adding steps would require spec re-approval.
- Backwards compat with legacy basic applicants maintained.