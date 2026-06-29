# Requirements — Advanced Application

> Spec ID: `001` · Type: member-facing feature · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `012-form-schema-system`, `014-tier-abstraction`
> Source today: `professional_form/FORM_PLAN.md` + `src/lib/forms/schemas/advancedApply.ts` + `/api/advanced/*`

## Overview

The Advanced application is the 8-step wizard that professional-level applicants complete to apply for full membership. It is data-driven via the form-schema system (`012`); this spec captures the user-facing and storage requirements.

## Functional Requirements

- **REQ-AA-001** 8-step wizard in order: About You → Training → Experience → Further Requirements → Competencies → Referees → Declarations → Uploads.
- **REQ-AA-002** About You captures: firstName, lastName, dateOfBirth, ethnicity, address, postalAddress, phone, email, businessName, website. Email is the login identity for resume.
- **REQ-AA-003** Training is a repeatable group: array of `{ name, provider, year }`. Persisted as JSON in column L (qualifications).
- **REQ-AA-004** Experience is a repeatable group: array of `{ name, provider, year, narrative }`. Persisted as JSON in column M.
- **REQ-AA-005** Further Requirements: 8 Y/N questions covering background checks, scope acknowledgement, etc. Persisted as JSON object in column N.
- **REQ-AA-006** Core Competencies: 21 Y/N grid; competency IDs derived from schema options map. Persisted as JSON array in column O.
- **REQ-AA-007** Referees: 2 contacts (name, role, email, phone) → columns P–W.
- **REQ-AA-008** Declarations: 8 checkboxes (accuracy, ethics, scope, doula services, interview, professional development, criminal check, meetings) + `signed_at` ISO timestamp → columns X–AF.
- **REQ-AA-009** Document Upload: 6 required categories (training, ethics, criminal, advance_care, assisted_dying, fundamentals) + 1 optional (insurance). See spec `004`.
- **REQ-AA-010** Completion gate (REQ-OV-001 state machine): all required form fields filled AND all 6 required doc categories have ≥1 uploaded file. Insurance is optional and does not block completion.
- **REQ-AA-011** Autosave serialised: client queue + server-side per-applicant queue. Identity fields (`firstName`, `lastName`, `phone`, `email`) persisted with form data on every save.
- **REQ-AA-012** Resume hydration returns `applicantId` for reliable token resume (REQ-OV-004).
- **REQ-AA-013** "Proceed to Payment" activates only when `complete=TRUE`. Calls `/api/advanced/upload-complete` which returns Stripe checkout URL.

## Non-Functional Requirements

- **NFR-AA-001** Per-step save progress survives browser refresh via resume token.
- **NFR-AA-002** Validation errors shown inline; save still succeeds with partial data.
- **NFR-AA-003** Step navigation: forward (next button), backward (back button), direct (sidebar with completed-check marks).

## Acceptance Criteria

1. Fresh applicant: starts at step 1 with empty form; saving step 1 with name+email returns `applicantId` + `token`.
2. Returning via resume link: form pre-populates including identity fields and uploaded doc counts.
3. Upload 3 files to training category → all 3 visible; deleting middle → 2 remain.
4. Skip a required field → step cannot advance; error shown inline.
5. Mark all required docs uploaded + all required fields filled → "Proceed to Payment" enables.
6. Click "Proceed to Payment" → Stripe Checkout opens → on success webhook fires → applicant marked `paid`.
7. Refresh browser mid-form → autosave restores last state.

## Out of Scope

- Multi-language form copy (single locale).
- Draft auto-delete after N days of inactivity.
- Real-time form preview.

## Related

- `src/lib/forms/schemas/advancedApply.ts` — schema definition
- `src/lib/forms/schemas/advancedApply.content.json` — labels, options
- `src/pages/apply/advanced.astro` — wizard page (legacy; being phased to schema-driven)
- `src/pages/api/advanced/apply.ts` — autosave handler
- `src/pages/api/advanced/upload-complete.ts` — checkout trigger
- `.wolf/buglog.json` — bug-002 (visibleWhen excludes fields from toRow)