# Tasks — Document Upload

> Spec ID: `004` · Type: member-facing feature
> Status: backfilled. Approval pending first upload-flow change.

## Phase 1: Foundation
- [x] `src/lib/google-drive.ts` DWD impersonation
- [x] Drive Files sheet lazy creation
- [x] Multi-file per doc type
- [x] Count columns AI–AO on Advanced Applications

## Phase 2: Upload Endpoint
- [x] POST `/api/advanced/upload-file` JSON + multipart
- [x] Size validation (10MB cap)
- [x] MIME validation (PDF/JPEG/PNG/GIF/DOC/DOCX)
- [x] Filename sanitisation
- [x] Drive path: `/applications/{applicantId}/documents/{docType}/{fileId}.{ext}`

## Phase 3: Delete Endpoint
- [x] POST `/api/advanced/delete-file` soft delete
- [x] Drive file → trash
- [x] Count column decrement
- [x] Token-gated (fileId + applicant must match)

## Phase 4: Schema-Driven Upload Categories
- [x] Doc types derived from `schema.uploads` (Phase J3)
- [x] Per-type labels from `content.json`

## Phase 5: Future
- [ ] Virus scan integration
- [ ] OCR for criminal check
- [ ] File preview UI
- [ ] Storage quota monitoring

## Notes
- Counts derived from Drive Files sheet, not incremented — prevents race conditions.
- Insurance is optional; does not block completion gate.