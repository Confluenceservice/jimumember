# Tasks — Application Resume

> Spec ID: `003` · Type: member-facing feature
> Status: backfilled. Approval pending first resume-flow change.

## Phase 1: Token-First Lookup
- [x] `getApplicantByToken()` in google-sheets.ts
- [x] GET `/api/advanced/apply?token=X` handler
- [x] Token-first, email fallback
- [x] Response includes `applicantId` (REQ-AR-004)

## Phase 2: Email Verification
- [x] `markEmailVerified()` flips column AU to TRUE
- [x] Resume link click → verification trigger
- [x] Backwards compat: blank AU treated as verified (legacy rows)

## Phase 3: Resume-Link Email
- [x] `sendResumeLink()` templated email
- [x] Sent on first save if email provided
- [x] `/api/advanced/resend-link` endpoint

## Phase 4: Client Persistence
- [x] `window.__token__` set on first save
- [x] Survives browser refresh (sessionStorage backup)

## Phase 5: Bug Fixes
- [x] Token-first defence: previous email-based lookup was insecure

## Notes
- Spec must be re-approved if token storage strategy changes.
- Email lookup is fallback only when token absent AND email verified.