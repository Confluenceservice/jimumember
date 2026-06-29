# Design — Google Workspace Integration

> Spec ID: `013` · Type: cross-cutting
> Depends on: `000-platform-overview`, `015-environment-configuration`

## Overview

Single Service Account + DWD impersonation. Three Google APIs. Retry-with-jitter.

## Component Design

1. **`src/lib/google-sheets.ts`** — Sheets adapter. Functions per spec (`001`, `002`, `004`, `005`).
2. **`src/lib/google-drive.ts`** — Drive adapter. File upload, delete (trash), list.
3. **`src/lib/google-docs.ts`** — Docs adapter. Review doc creation, index doc refresh.
4. **Retry helper** in `renewal-sheet.ts` — 5-attempt exponential backoff with jitter.

## Auth Setup

```typescript
import { google } from 'googleapis';

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\n'),
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
  ],
  subject: process.env.GOOGLE_WORKSPACE_IMPERSONATE_USER,
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });
const docs = google.docs({ version: 'v1', auth });
```

## Retry Helper

```typescript
async function withRetry<T>(op: () => Promise<T>, label: string): Promise<T> {
  const delays = [500, 1000, 2000, 4000];
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await op();
    } catch (e: any) {
      const transient = ['ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND'].includes(e.code) ||
                        e.message?.includes('socket hang up') ||
                        (e.response?.status >= 500 && e.response?.status < 600);
      if (!transient || attempt === 4) throw e;
      const jitter = Math.random() * 100;
      await new Promise(r => setTimeout(r, delays[attempt] + jitter));
      logger.warn({ label, attempt: attempt + 1 }, 'google api retry');
    }
  }
  throw new Error('unreachable');
}
```

## Data Flow (Sheet Append Example)

```
appendBasicApplication(values)
   │
   ▼
withRetry(() => sheets.spreadsheets.values.append({
   spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
   range: 'Basic Applications!A:P',
   valueInputOption: 'RAW',
   requestBody: { values: [toRow(values)] }
}), 'sheets.append')
```

## Drive Folder Structure

```
GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID/
└── applications/
    └── {applicantId}/
        └── documents/
            ├── training/
            │   ├── {fileId1}.pdf
            │   ├── {fileId2}.pdf
            │   └── ...
            ├── ethics/
            └── ...
```

## Error Mapping

| googleapis error | App error code |
|---|---|
| 401 / token expired | `AUTH_FAILED` |
| 403 / scope denied | `INSUFFICIENT_PERMISSIONS` |
| 404 / spreadsheet not found | `SPREADSHEET_NOT_FOUND` |
| 429 / rate limit | `RATE_LIMITED` (caller retries) |
| 5xx | retried up to 5× |

## Testing Strategy

- Adapter tests with mocked googleapis client
- Retry helper test (succeeds on attempt 3 after 2 transient errors)
- DWD scope test (verifies scope list)

## Risks

- Workspace admin changes DWD: all Sheets/Drive/Docs calls fail. Mitigation: health check reports `degraded`; runbook for re-granting.
- Service Account key rotation: requires app restart. Mitigation: documented in `docs/runbooks/google-workspace-domain-wide-delegation.md`.

## Future Considerations

- Per-tier spreadsheet (today: one spreadsheet, multiple tabs)
- Shared Drive support (org-wide files)
- Workspace audit log integration