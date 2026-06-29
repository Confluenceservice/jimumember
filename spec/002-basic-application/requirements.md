# Requirements — Basic Application

> Spec ID: `002` · Type: member-facing feature · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `012-form-schema-system`, `014-tier-abstraction`
> Source today: `src/lib/forms/schemas/basicApply.ts` + `src/pages/api/apply.ts`

## Overview

The Basic application is a single-page form for associate-level membership. Captures identity, address, business details, training summary, optional directory listing, and a signature. Payment is one-time, hosted on a Stripe Payment Link.

## Functional Requirements

- **REQ-BA-001** Single-step form: no wizard. All fields on one page.
- **REQ-BA-002** Captures: firstName, lastName, email, phone, fullAddress, postalAddress, businessName, interestJoining (why join), trainingDetails, listOnPage (yes/no), listingDetails (conditional), signature, applicationDate.
- **REQ-BA-003** `listOnPage` is a Y/N radio. When `yes`, `listingDetails` becomes required (visibleWhen predicate).
- **REQ-BA-004** `signature` is a typed-text field (legal name). `applicationDate` auto-fills on submit.
- **REQ-BA-005** Submit → row appended to Basic Applications sheet (16 cols A–P) with `checkout_status = "pending"` → Stripe Checkout Session created.
- **REQ-BA-006** On webhook `checkout.session.completed` → `checkout_status` flipped to `"paid"`. Review doc + confirmation email.

## Non-Functional Requirements

- **NFR-BA-001** Submit-then-redirect flow (no autosave; basic is single-page).
- **NFR-BA-002** Mobile-friendly: signature field usable on touch devices.

## Acceptance Criteria

1. Fill all fields, tick "list on directory" + fill listing details → submit succeeds.
2. Tick "list on directory" but leave listing details blank → form blocks submit with inline error.
3. Submit → Stripe Checkout → on success, sheet row shows `paid`.
4. Existing basic applicant resume (legacy) still works (backwards compat).

## Out of Scope

- Multi-step wizard (single page by design).
- Resume-by-token (basic is single submit).
- File upload (basic applicants don't submit documents).

## Related

- `src/lib/forms/schemas/basicApply.ts`
- `src/lib/forms/schemas/basicApply.content.json`
- `src/pages/api/apply.ts` — POST handler
- `src/pages/api/create-checkout-session.ts` — Stripe session creation
- `src/lib/google-sheets.ts` — `appendBasicApplication()`