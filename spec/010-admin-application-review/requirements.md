# Requirements — Admin Application Review

> Spec ID: `010` · Type: system feature · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `001-advanced-application`, `002-basic-application`, `008-stripe-webhook-side-effects`
> Source today: `src/lib/google-docs.ts`

## Overview

On payment, a Google Doc is auto-generated summarising the application (personal details, training, experience, further requirements, competencies, referees, documents uploaded, declarations). Doc URL logged + emailed to admin. Index docs (per tier) refresh periodically for at-a-glance review.

## Functional Requirements

- **REQ-AAR-001** On payment, auto-generate review Doc for: advanced application, basic application.
- **REQ-AAR-002** Review Doc content: personal details, training list, experience list, further requirements answers, competency grid, referees, declarations, uploaded documents list (with Drive links), payment confirmation metadata.
- **REQ-AAR-003** Doc URL stored in email notification to admin + logged.
- **REQ-AAR-004** Folder: `GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID` or fallback `GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID`.
- **REQ-AAR-005** Index docs (one per tier): aggregate list of all paid applications with name, email, payment date, link to review Doc. Refresh on demand.
- **REQ-AAR-006** Review Doc generation is async (non-blocking) per REQ-SW-005.

## Non-Functional Requirements

- **NFR-AR-001** Doc generation failure → log + skip. Sheet update already succeeded; admin notified without Doc link.

## Acceptance Criteria

1. Advanced payment → review Doc created within 30s → admin email contains Doc URL.
2. Basic payment → review Doc created → admin email contains Doc URL.
3. Doc content includes all sections (personal details through declarations).
4. Index doc refresh shows all paid applications for the tier.

## Out of Scope

- Doc template customisation per org (today: single template).
- Doc versioning.
- Collaborative editing workflow.

## Related

- `src/lib/google-docs.ts` — `createApplicationReviewDoc()`, `refreshAdvancedIndexDoc()`, `refreshBasicIndexDoc()`
- `GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID` env var
- Spec `008` — webhook triggers Doc generation