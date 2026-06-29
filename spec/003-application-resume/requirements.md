# Requirements — Application Resume

> Spec ID: `003` · Type: member-facing feature · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview` (REQ-OV-004), `001-advanced-application`
> Source today: `src/pages/api/advanced/apply.ts` (GET handler), resume-link email flow

## Overview

Advanced applicants can leave the form mid-way and resume later via a tokenised link. The token is the source of truth; email is a fallback only when no token is supplied. This spec captures the resume contract.

## Functional Requirements

- **REQ-AR-001** Token-first lookup: `GET /api/advanced/apply?token=X` finds the applicant by `resume_token` (column AG). Email fallback only when `token` query param is absent.
- **REQ-AR-002** Resume link emailed on first save if `email` is provided. Template: `sendResumeLink(toEmail, fullName, resumeLink)`.
- **REQ-AR-003** Token persistence: `window.__token__` survives across retries. Re-hitting the API with the same token always finds the same applicant.
- **REQ-AR-004** GET response includes `applicantId` for reliable client-side hydration. Older code that relied on email+applicantId pairing breaks; this is the new contract.
- **REQ-AR-005** Email verification (REQ-OV-005): when an applicant opens the resume link, the email is verified (column AU flipped to TRUE). This prevents account takeover via email reuse.
- **REQ-AR-006** Resend link: `GET /api/advanced/resend-link?token=X` re-sends the resume-link email for applicants who lost it.

## Non-Functional Requirements

- **NFR-AR-001** Token is a UUIDv4, opaque, single-purpose.
- **NFR-AR-002** Email lookup is case-insensitive but never returns a different applicant when token matches.
- **NFR-AR-003** Resume hydration returns all form fields + uploaded doc counts (not file contents).

## Acceptance Criteria

1. New applicant saves first step → receives email with `?token=X` link.
2. Open link → form pre-populates including identity fields + uploaded doc counts.
3. Resume via `?token=X` works even after browser clear-cookies.
4. Resume via `?email=Y` (no token) works only when email is verified.
5. Resend-link endpoint sends a fresh email; old link still works.

## Out of Scope

- Resume-by-email for unverified applicants (security hole closed by REQ-AR-005).
- Resume-link expiry (links persist until applicant pays or row deleted).
- Multi-device concurrent resume (last write wins; server queue serialises).

## Related

- `src/pages/api/advanced/apply.ts` — GET handler
- `src/lib/email-sender.ts` — `sendResumeLink()`
- `src/lib/google-sheets.ts` — `getApplicantByToken()`, `markEmailVerified()`