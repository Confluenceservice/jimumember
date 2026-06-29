# Design — Document Upload

> Spec ID: `004` · Type: member-facing feature
> Depends on: `000-platform-overview`, `001-advanced-application`

## Overview

Multi-file upload per doc type. Drive stores files; Sheets tracks metadata. Soft-delete preserves audit trail.

## Component Design

1. **`src/pages/api/advanced/upload-file.ts`** — handles both JSON (base64) and multipart. Decodes, validates size + MIME, uploads to Drive, appends Drive Files row, increments Advanced Applications count column.
2. **`src/pages/api/advanced/delete-file.ts`** — soft delete: sets Drive Files `deleted=TRUE`, moves Drive file to trash.
3. **`src/lib/google-drive.ts`** — `uploadFileToDrive()`, `deleteFileFromDrive()`, `listDriveFiles()`.

## Data Flow

### Upload

```
Client FormData (multipart)
   │
   ▼
POST /api/advanced/upload-file
   │
   ▼
validateToken(token) → applicantId
   │
   ▼
validateFile(file): size ≤ 10MB, mime ∈ allowlist
   │
   ▼
uploadFileToDrive(folderId, filename, buffer) → driveFileId
   │
   ▼
append Drive Files sheet row { file_id: UUID, applicant_id, doc_type, original_filename, uploaded_at, deleted: 'FALSE' }
   │
   ▼
update Advanced Applications AI..AO: docTypeCount++
   │
   ▼
return { success: true, docType, fileId: driveFileId, message: 'uploaded' }
```

### Delete

```
POST /api/advanced/delete-file { fileId, token }
   │
   ▼
find Drive Files row by file_id AND applicant_id (token-gated)
   │
   ▼
update Drive Files row: deleted = 'TRUE'
   │
   ▼
deleteFileFromDrive(driveFileId) → trash
   │
   ▼
update Advanced Applications AI..AO: docTypeCount--
   │
   ▼
return { success: true }
```

## Storage

### Drive Files sheet (6 cols, A–F)

```
A file_id            UUID, generated at upload
B applicant_id       FK to Advanced Applications A
C doc_type           enum: training | ethics | criminal | advance_care | assisted_dying | fundamentals | insurance
D original_filename  as-supplied by user
E uploaded_at        ISO 8601 timestamp
F deleted            TRUE | FALSE
```

### Advanced Applications count columns (AI–AO)

```
AI doc_training_count
AJ doc_ethics_count
AK doc_criminal_count
AL doc_advance_care_count
AM doc_assisted_dying_count
AN doc_fundamentals_count
AO doc_insurance_count  (optional; does not block completion)
```

## Error Codes

- `INVALID_TOKEN` — token/applicant mismatch
- `INVALID_FILE_TYPE` — MIME not in allowlist
- `FILE_TOO_LARGE` — exceeds 10MB
- `UPLOAD_FAILED` — Drive API error
- `INSUFFICIENT_PERMISSIONS` — DWD impersonation failure

## Testing Strategy

- `upload-file.test.ts` — JSON + multipart paths, validation, Drive mock
- `delete-file.test.ts` — soft-delete + count decrement
- Drive Files sheet lazy-creation test

## Risks

- Drive quota: per-Workspace limits. Mitigation: clear trash regularly, monitor via Sheets.
- Race: two simultaneous uploads to same doc type. Mitigation: Sheets append is idempotent; counts re-derive from Drive Files sheet, not incremented.

## Future Considerations

- Client-side virus scan (ClamAV integration).
- OCR for `criminal` check docs.
- File preview UI.