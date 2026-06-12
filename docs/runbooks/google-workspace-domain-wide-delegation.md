# Google Workspace Domain-Wide Delegation for ELDAA Drive Uploads

Use this when Drive uploads 403 with `storageQuotaExceeded` and the cause is
the service account (SA) having no storage. Symptom in logs:

```
errorMessage: "Service Accounts do not have storage quota. Leverage shared
               drives ..., or use OAuth delegation ... instead."
apiErrorReason: "storageQuotaExceeded"
apiErrorDomain: "usageLimits"
upstreamUrl:    "https://www.googleapis.com/upload/drive/v3/files?..."
```

The app now supports DWD impersonation: when `GOOGLE_WORKSPACE_IMPERSONATE_USER`
is set, all Google API calls (Drive, Docs, Sheets) run on behalf of a real
Workspace user, which has Drive storage. Without it, the SA acts as itself
and Drive uploads 403.

## When to use this

- Drive uploads 403 with `storageQuotaExceeded`
- Sheets writes are fine but Drive folder create / file upload / file copy
  all fail with the same error

If only the Drive path is failing and the destination folder is in a
Workspace Shared Drive where the SA is already a member, prefer the cheaper
fix: confirm SA membership in the Shared Drive (no DWD, no code change).

## One-time GCP + Workspace admin setup

### 1. Find or create a Workspace user for uploads

The impersonation user must:
- Exist in the same Workspace tenant (`eldaa.org.nz`)
- Have enough Drive storage for the documents you'll upload
- Not be a real human's account (a shared mailbox or admin-created user is
  ideal — if the SA key leaks, the blast radius is the impersonation user,
  not a person)

`no-reply@eldaa.org.nz` is the existing sender for transactional email; it
also works as the Drive impersonation user and avoids creating a new account.

### 2. Get the service account Client ID

In GCP Console → IAM & Admin → Service Accounts, open
`eldaa-sheets@stripe-billing-491503.iam.gserviceaccount.com`. Under
"Advanced settings" → "Show domain-wide delegation", the **Client ID**
field has the numeric ID. Copy it.

(If "Show domain-wide delegation" is not visible, click "Edit" on the SA
and check **"Enable Google Workspace Domain-wide Delegation"**, then save.)

### 3. Authorize the scopes in Workspace Admin Console

Workspace Admin → Security → API Controls → "Manage Domain Wide Delegation"
→ "Add new". Paste the SA Client ID and add these OAuth scopes (one per
line, exactly as written):

```
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/documents
https://www.googleapis.com/auth/spreadsheets
```

All three are required because the app's JWT helper issues calls under each
scope. Authorizing only `drive` will make Sheets reads/writes 401 once
impersonation kicks in.

Save. Changes propagate within a few minutes.

### 4. Roll the env var to Fly

```sh
fly secrets set -a eldaa \
  GOOGLE_WORKSPACE_IMPERSONATE_USER=no-reply@eldaa.org.nz

fly secrets set -a eldaa-production \
  GOOGLE_WORKSPACE_IMPERSONATE_USER=no-reply@eldaa.org.nz
```

Restart the running machines (or wait for auto-stop) so the new env is
picked up:

```sh
fly machine list -a eldaa
fly machine stop <started-id> -a eldaa
# next request cold-starts a fresh machine
```

### 5. Verify

```sh
fly logs -a eldaa --no-tail | grep google_service_account_auth
# expect: {"impersonating":true,"subject":"no-reply@eldaa.org.nz",...}
```

Then trigger a real upload (e.g. submit one document via the apply form).
The Fly log line for `document_uploaded` should appear, and the Drive file
should land in the configured `applications/` folder.

## Rollback

If impersonation breaks something unexpected (e.g. the impersonation user
lacks access to a folder the SA was previously sharing itself into):

```sh
fly secrets unset -a eldaa GOOGLE_WORKSPACE_IMPERSONATE_USER
fly secrets unset -a eldaa-production GOOGLE_WORKSPACE_IMPERSONATE_USER
```

Without the env var, the helper stops adding the `subject` claim and the
SA acts as itself. Drive uploads will go back to 403-ing with
`storageQuotaExceeded` — that's the original state, not a new failure.

## Related

- `src/lib/google-auth.ts` — the helper that reads the env var and adds
  the `subject` claim
- `bug-058` (PUBLIC_SITE_URL was stale on staging) — same shape of fix
  (env var on Fly, no code change)
