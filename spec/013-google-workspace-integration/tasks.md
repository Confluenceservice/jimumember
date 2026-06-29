# Tasks — Google Workspace Integration

> Spec ID: `013` · Type: cross-cutting
> Status: backfilled. Approval pending first Google-API change.

## Phase 1: Auth Foundation
- [x] Service Account JWT setup with DWD impersonation
- [x] Three Google API clients (Sheets, Drive, Docs)
- [x] PEM key handling (replace `\\n` → `\n`)

## Phase 2: Sheets Adapter
- [x] `appendBasicApplication()`
- [x] `createApplicantRow()` (47 cols)
- [x] `updateApplicantFormData()`
- [x] `getApplicantByToken()`
- [x] `getApplicantByEmail()`
- [x] `markEmailVerified()`
- [x] `validateCompletion()`
- [x] `getUploadStatus()`
- [x] Drive Files sheet lazy creation

## Phase 3: Drive Adapter
- [x] `uploadFileToDrive()` (DWD impersonation)
- [x] `deleteFileFromDrive()` (trash, not permanent)
- [x] `listDriveFiles()`
- [x] Folder path: `/applications/{applicantId}/documents/{docType}/{fileId}.{ext}`

## Phase 4: Docs Adapter
- [x] `createApplicationReviewDoc()` (advanced)
- [x] `createBasicApplicationReviewDoc()`
- [x] `refreshAdvancedIndexDoc()`
- [x] `refreshBasicIndexDoc()`

## Phase 5: Retry Helper
- [x] 5-attempt exponential backoff (500/1000/2000/4000ms + jitter)
- [x] Transient error detection (ECONNRESET, EAI_AGAIN, socket hang up, 5xx)
- [x] Applied to all Sheets operations

## Phase 6: Future
- [ ] Per-tier spreadsheet (multi-tenant)
- [ ] Workspace audit log integration
- [ ] Shared Drive support

## Notes
- Service Account key + impersonation user must be set together. Missing either → MissingConfigError.
- All Google API failures surface typed error codes; raw googleapis errors never reach the caller.