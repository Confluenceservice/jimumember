# Tasks — PD Logging

> Spec ID: `006` · Type: member-facing feature
> Status: backfilled. Approval pending first PD-log change.

## Phase 1: Schema (Phase H)
- [x] `pdLog.ts` synthetic single-entry schema
- [x] Per-entry validation in handler
- [x] dateCompleted, activity, totalHours, provider fields

## Phase 2: API Endpoints
- [x] GET `/api/renew/pd-log?token=X` returns entries
- [x] POST `/api/renew/pd-log` validates + writes
- [x] `dryRun` flag support
- [x] Per-entry errors with index in response

## Phase 3: Storage
- [x] `updateRenewalPdEntries()` writes JSON to Renewals H
- [x] JSON parse on GET with try/catch fallback

## Phase 4: Bug Fixes
- [ ] bug-004: minRows enforcement (planned, not landed)

## Phase 5: Future
- [ ] Min rows enforcement
- [ ] PD hours total display
- [ ] CSV export for admin reporting
- [ ] External PD provider integration

## Notes
- Only advanced tier uses PD logging.
- Bug-004 (minRows not enforced) is open; spec must be re-approved before fixing.