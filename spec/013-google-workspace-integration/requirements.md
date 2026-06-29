# Requirements — Google Workspace Integration

> Spec ID: `013` · Type: cross-cutting · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `015-environment-configuration`
> Source today: `src/lib/google-sheets.ts`, `src/lib/google-drive.ts`, `src/lib/google-docs.ts`

## Overview

Single Service Account with Domain-Wide Delegation (DWD) impersonates a Workspace user. Three Google APIs used: Sheets (read/write), Drive (upload/delete), Docs (review generation). Retry-with-jitter for transient network drops.

## Functional Requirements

- **REQ-GW-001** Single Service Account (`GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`) with private key (`GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY`, PEM format).
- **REQ-GW-002** DWD impersonation: `GOOGLE_WORKSPACE_IMPERSONATE_USER` is the Workspace user being impersonated. Required scopes granted at Workspace admin level.
- **REQ-GW-003** Three Google APIs with distinct scopes:
  - **Sheets**: `https://www.googleapis.com/auth/spreadsheets` (read/write)
  - **Drive**: `https://www.googleapis.com/auth/drive` (DWD required for server-side upload)
  - **Docs**: `https://www.googleapis.com/auth/documents` (read/write)
- **REQ-GW-004** Spreadsheet ID: `GOOGLE_SHEETS_SPREADSHEET_ID`. All Sheets operations scoped to this spreadsheet.
- **REQ-GW-005** Drive folders: `GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID` (file uploads), `GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID` (review docs, optional fallback to applications folder).
- **REQ-GW-006** Retry policy: 5 attempts with exponential backoff + jitter (500/1000/2000/4000ms). Applied to all Sheets operations. Catches `ECONNRESET`, `EAI_AGAIN`, socket hang up, 5xx responses.
- **REQ-GW-007** Drive Files sheet lazy-created on first upload (per spec `004`). Schema: file_id, applicant_id, doc_type, original_filename, uploaded_at, deleted.

## Non-Functional Requirements

- **NFR-GW-001** Service Account key never logged. pino redact list includes `*KEY*`.
- **NFR-GW-002** DWD impersonation failures surface as `INSUFFICIENT_PERMISSIONS` error code.
- **NFR-GW-003** Sheets operations return typed errors, not raw `googleapis` errors.

## Acceptance Criteria

1. New advanced application → row appended to Advanced Applications sheet within 5s.
2. Document upload → file appears in Drive folder + row in Drive Files sheet.
3. Drive API transient error → retries 5× with backoff → succeeds without user-visible delay.
4. Service Account key missing → MissingConfigError at startup.
5. DWD not granted at Workspace admin → INSUFFICIENT_PERMISSIONS error.

## Out of Scope

- Multiple Workspace tenants (one org = one tenant).
- Per-user OAuth (DWD impersonation only).
- Gmail API (Mailgun used instead; see spec `009`).

## Related

- `src/lib/google-sheets.ts` — Sheets adapter
- `src/lib/google-drive.ts` — Drive adapter
- `src/lib/google-docs.ts` — Docs adapter
- `docs/runbooks/google-workspace-domain-wide-delegation.md` — DWD setup
- Spec `004` — Drive Files sheet contract
- Spec `008` — webhook triggers review Doc generation