# Tasks — Platform Overview

> Spec ID: `000` · Type: platform/index
> Status: backfilled. Approval pending first feature change.

## Phase 1: Index Establishment
- [x] Define REQ-OV-001..014 in requirements.md
- [x] Document 47/16/14/6 sheet column contracts in design.md
- [x] Link from every feature spec's requirements.md "Depends on" header

## Phase 2: Migration Off CLAUDE.md
- [x] Strip application-states + API-endpoints + sheet-column-map from `CLAUDE.md`
- [x] Add pointer: `> Domain specification lives at spec/000-platform-overview/`
- [x] Verify root `CLAUDE.md` retains only Cognee + OpenWolf + project-blurb sections

## Phase 3: Cross-Spec Integrity
- [ ] `grep -r '000-platform-overview' spec/*/requirements.md` returns ≥15 matches (one per other spec)
- [ ] Each feature spec's `tasks.md` references at least one REQ-OV-*
- [ ] No REQ-ID collision across specs (each ID globally unique within spec, namespaced by SPEC-ID)

## Phase 4: Approval Gate
- [ ] `/spec:approve requirements` writes `.requirements-approved`
- [ ] Future schema-abstraction refactor cites REQ-OV-IDs in PR descriptions

## Notes
- This spec is the **index** — it carries no implementation tasks. Tasks belong to feature specs (`001`–`015`).
- Approving this spec gates every other spec's `design.md` work.