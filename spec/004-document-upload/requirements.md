# Requirements — Document Upload

> Spec ID: `004` · Type: member-facing feature · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `001-advanced-application`
> Source today: `/api/advanced/upload-file`, `/api/advanced/delete-file`, Drive Files sheet

## Overview

Advanced applicants upload supporting documents across 7 categories (6 required, 1 optional). Files stored in Drive under `/applications/{applicantId}/documents/{docType}/{fileId}.{ext}`. Each file gets a row in the Drive Files sheet for soft-delete tracking.

## Functional Requirements

- **REQ-DU-001** 7 doc types: `training`, `ethics`, `criminal`, `advance_care`, `assisted_dying`, `fundamentals`, `insurance`. The first 6 are required for completion; `insurance` is optional.
- **REQ-DU-002** Multi-file per category: a single category (e.g. `training`) can hold multiple files. Upload count column tracks this per row.
- **REQ-DU-003** Upload via `/api/advanced/upload-file`. Accepts JSON `{ token, docType, filename, mimeType, data(base64) }` OR multipart `{ token, docType, file }`. Returns `{ success, docType, fileId, message }`.
- **REQ-DU-004** Drive path: `/applications/{applicantId}/documents/{docType}/{fileId}.{ext}`. `fileId` is a random UUID; original filename preserved in Drive Files sheet column D.
- **REQ-DU-005** File limits: max 10MB per file. Allowed MIME types: PDF, JPEG, PNG, GIF, DOC, DOCX. Enforced server-side.
- **REQ-DU-006** Soft delete via `/api/advanced/delete-file`: `{ fileId, token }`. Sets column F (`deleted`) to TRUE; Drive file moved to trash.
- **REQ-DU-007** Per-applicant upload counts written to columns AI–AO of Advanced Applications sheet (one column per doc type). Refreshed on each upload/delete.
- **REQ-DU-008** Drive Files sheet lazy-created on first upload. Schema: file_id, applicant_id, doc_type, original_filename, uploaded_at, deleted.

## Non-Functional Requirements

- **NFR-DU-001** Uploads are idempotent: re-uploading the same fileId is a no-op.
- **NFR-DU-002** Filename sanitisation: strip path separators and control characters before storing.
- **NFR-DU-003** MIME type sniffing: trust the client `mimeType` but verify by extension match.

## Acceptance Criteria

1. Upload 3 PDFs to `training` → Drive Files sheet has 3 rows; AI column shows `3`.
2. Delete middle file → 2 rows remain (deleted file has `deleted=TRUE`).
3. Upload 11MB file → 413 response, no Drive file created.
4. Upload `.exe` → 415 response, no Drive file created.
5. Refresh browser → uploaded files still listed (resume re-fetches counts).
6. Completion gate: when AI–AN all ≥1 and AP="FALSE", "Proceed to Payment" enables.

## Out of Scope

- File preview (link to Drive only).
- Virus scanning.
- OCR / text extraction.

## Related

- `src/pages/api/advanced/upload-file.ts` — JSON + multipart handler
- `src/pages/api/advanced/delete-file.ts` — soft delete
- `src/lib/google-drive.ts` — `uploadFileToDrive()`, `deleteFileFromDrive()`
- `src/lib/google-sheets.ts` — Drive Files sheet lazy creation
- Spec `001` — completion gate consumes upload counts