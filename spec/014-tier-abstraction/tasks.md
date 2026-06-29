# Tasks — Tier Abstraction

> Spec ID: `014` · Type: cross-cutting
> Status: backfilled. Approval pending first tier change.

## Phase 1: Tier Rename (Phase M)
- [x] Rename `professional` → `advanced` in TIERS
- [x] Rename `associate` → `basic` in TIERS
- [x] Update storage values `pm` → `adv`, `am` → `basic`
- [x] Update all schemas to new slugs
- [x] Update all API routes to new tier names
- [x] Verify 282 tests pass
- [x] Verify `npm run check` 0 errors

## Phase 2: Type Auto-Extension (Phase K)
- [x] Widen literal unions (`MembershipPlan = keyof typeof TIERS`)
- [x] `tierLabelFor()` helper added
- [x] `getLookupKey()` template-literal pattern
- [x] Env-var routing split (STAGING_PREFIX-aware)
- [x] Bug-003 fixed: UnknownTierError instead of silent default

## Phase 3: N-Tier Readiness
- [ ] Document how to add a third tier (runbook entry)
- [ ] Verify `MembershipPlan` extends automatically on TIERS change
- [ ] Add `add-a-new-tier.md` cross-reference to this spec

## Notes
- Adding a tier = adding to TIERS object. No other TS changes required thanks to auto-extension.
- Storage values are frozen; renaming a tier updates label only.