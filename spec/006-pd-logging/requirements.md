# Requirements — PD Logging

> Spec ID: `006` · Type: member-facing feature · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `005-membership-renewal`, `012-form-schema-system`
> Source today: `pdLog.ts` schema + `/api/renew/pd-log` GET/POST

## Overview

Advanced members log professional-development (PD) entries after renewal. Each entry: dateCompleted, activity, totalHours, provider. Entries stored as JSON array in Renewals column H. No PD logging for basic members.

## Functional Requirements

- **REQ-PD-001** PD log form accessible via `/renew/pd-log?token={renewalId}`. Token = renewal_id.
- **REQ-PD-002** Form is repeatable: members can add/remove entries freely. Each entry validated independently before save.
- **REQ-PD-003** Entry fields: dateCompleted (date), activity (text), totalHours (number, ≥0), provider (text).
- **REQ-PD-004** Synthetic schema pattern (Phase H): a single-entry schema is defined; the handler calls `validate()` per entry before writing the array.
- **REQ-PD-005** GET `/api/renew/pd-log?token=X` returns current entries from Renewals column H.
- **REQ-PD-006** POST `/api/renew/pd-log` accepts `{ token, entries: [...] }`, validates each entry, writes back to Renewals H.
- **REQ-PD-007** `dryRun` flag accepted (consistent with checkout dry-run); validates without writing.
- **REQ-PD-008** Validation: `dateCompleted` ≤ today; `totalHours` ≥ 0; `activity` + `provider` non-empty.

## Non-Functional Requirements

- **NFR-PD-001** Per-entry validation surfaces all errors at once (don't bail on first).
- **NFR-PD-002** No `minRows` enforcement today (bug-004: was planned, not landed; future).

## Acceptance Criteria

1. Open `/renew/pd-log?token=X` → form pre-populated with current entries.
2. Add entry with `totalHours: -1` → form blocks with inline error.
3. Add entry with future date → form blocks with inline error.
4. Save 3 valid entries → Renewals H column updated to JSON array of 3 entries.
5. Refresh page → entries persist.
6. `dryRun=true` → no write; returns `{ success: true, dryRun: true }`.

## Out of Scope

- PD log for basic members (not required by membership tier).
- PD hours totals / reports (admin can compute from Sheet).
- External PD provider integration (manual entry only).

## Related

- `src/lib/forms/schemas/pdLog.ts` — synthetic single-entry schema
- `src/pages/renew/pd-log.astro` — form page
- `src/pages/api/renew/pd-log.ts` — GET/POST handler
- `src/lib/renewal-sheet.ts` — `updateRenewalPdEntries()`
- `.wolf/buglog.json` — bug-004 (minRows not enforced)