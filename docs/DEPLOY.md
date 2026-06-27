# Deploy Re:Member for a new organisation

This is the entry-point playbook for standing up a fresh Re:Member instance. Follow it from Phase 0 through Phase 15 — every phase has concrete commands and a verification step that produces a machine-checkable signal.

The blueprint ships with sample form content from a single professional-membership organisation (ELDAA — End of Life Doula Alliance Aotearoa). Before pointing it at real applicants, replace that content (Phase 11) and rename everything that mentions the blueprint org (Phase 1).

**Audience:** the deploying party (you — a sysadmin, agency engineer, or volunteer). **Target audience for the deployed instance:** the client's volunteer admin running the org from a spreadsheet.

## 0. Before you start

### Inputs to collect

| Input | Example (itdocsnow.com) | Where it lands |
|---|---|---|
| Org display name | "ItDocsNow Member Services" | `ORG_NAME` |
| Org public URL | `https://itdocsnow.com` | `PUBLIC_ORG_URL` |
| Reply-To mailbox | `membership@itdocsnow.com` | `SUPPORT_EMAIL` |
| Admin notification mailbox | `admin@itdocsnow.com` | `ADMIN_EMAIL` |
| Workspace primary domain | `itdocsnow.com` | DWD subject + impersonation user |
| Impersonation user (mailbox) | `it-admin@itdocsnow.com` | `GOOGLE_WORKSPACE_IMPERSONATE_USER` |
| Sending subdomain (Mailgun) | `mg.itdocsnow.com` | `MAILGUN_DOMAIN` |
| Fly org slug | `itdocsnow-member` | `fly orgs create itdocsnow-member` |
| Fly app names | `itdocsnow-staging`, `itdocsnow-production` | `fly.toml` + workflows |
| Worker name | `itdocsnow-health-alert` | `wrangler.toml` + Slack label |
| Stripe price currency | `nzd` | (hardcoded in `stripe-products.ts:72`) |
| Fly region | `syd` | `fly.toml` `primary_region` |

### Tenancy model (read this before Phase 1)

| Account / org | Per what? | Where |
|---|---|---|
| **Stripe account** | Per client | Client's Stripe dashboard |
| **Mailgun account** | Per client | Client's Mailgun dashboard |
| **Google Cloud project** | Per client | GCP console (one project per client) |
| **Cloudflare account** | Per deploying party | One account, many Workers |
| **Fly.io account** | Per deploying party | The deploying party's card bills all client orgs |
| **Fly.io org** | Per client | One org per client; contains the two apps |
| **GitHub repo** | Per client | Fork under client's GH org (or deploying party's fork) |

Concretely: the deploying party signs up once for Cloudflare, Fly, and GitHub. They get a card on file for Fly. Each new client = a new Fly org (under the same account), a new GCP project, a new Stripe account (provided by the client), a new Mailgun account (also client-provided), a new Cloudflare Worker.

### Decision matrix

| Decision | Default | When to deviate |
|---|---|---|
| Email provider | Mailgun | Gmail OAuth only if Mailgun is unavailable in the client's region |
| Fly apps per client | Staging + Production | Staging-only for throwaway demo deploys |
| Mailgun region | US (`api.mailgun.net`) | EU requires a code change to `src/pages/api/health.ts` Mailgun probe URL — deserves its own PR |
| Stripe currency | `nzd` (hardcoded) | Change in `src/lib/stripe-products.ts:72` — deserves its own PR |

### Stripe env var numbering (read this too)

To stay N-tier-ready, the price env vars use an **enumerated suffix** keyed to the tier's position in `src/lib/forms/tiers.ts`. The mapping table is documented in the comment block at the top of that file:

| Tier slug | Index N | Application | Renewal |
|---|---|---|---|
| `basic` | 1 | `STRIPE_PRICE_1` | `STRIPE_PRICE_1_RENEWAL` |
| `advanced` | 2 | `STRIPE_PRICE_2` | `STRIPE_PRICE_2_RENEWAL` |
| (3rd tier) | 3 | `STRIPE_PRICE_3` | `STRIPE_PRICE_3_RENEWAL` |

The numbering is fixed by tier definition order. Adding a 3rd tier is one entry in `tiers.ts` + one env var pair + two schema files. Nothing else.

### Phase map

| # | Phase | Output |
|---|---|---|
| 1 | Clone & rename | Repo on client's fork, all blueprint names stripped |
| 2 | Google Cloud project + service account | GCP project + SA + numeric Client ID |
| 3 | Google Workspace preparation | Workspace exists, impersonation user confirmed |
| 4 | Drive folders + Sheets skeleton | Two folders + one spreadsheet, SA shared in |
| 5 | Workspace Domain-Wide Delegation | DWD authorized in admin console |
| 6 | Mailgun domain + sending account | Domain verified, API key captured |
| 7 | Stripe products, prices, webhook endpoint | 4 price IDs + 2 webhook signing secrets |
| 8 | Cloudflare account + health-alert Worker | Worker deployed, 5 secrets set, URL captured |
| 9 | Fly app bootstrap (staging + production) | Fly org created, 2 apps created, 23 secrets per app set |
| 10 | GitHub repo + Actions secrets | CI/CD wired to deploy + alert |
| 11 | Per-tier application form requirements | ELDAA sample content replaced with target org's |
| 12 | First deploy + smoke test | Staging live, health endpoint green, end-to-end apply works |
| 13 | itdocsnow.com test pass — concrete values | (See Phase 13 for itdocsnow.com pinned values) |
| 14 | Verification matrix | 13-row sign-off |
| 15 | Rollback / re-run | Per-key rollback, idempotency notes |

---

## 1. Clone & rename

```sh
git clone https://github.com/thomasbergernz/re-member.git itdocsnow-member
cd itdocsnow-member
git remote rename origin upstream

# Fork the repo to the client's GH org via the GitHub UI, then:
git remote add origin git@github.com:<client-org>/itdocsnow-member.git
git push -u origin main
```

**Rename locations** (exact paths, current values in parens):

- `fly.toml:6` — `app = 'remember-staging'` → `app = 'itdocsnow-staging'`
- `fly.toml:7` — `primary_region = 'syd'` (keep unless client is elsewhere)
- `.github/workflows/fly-deploy-staging.yml:14` — `--app remember-staging` → `--app itdocsnow-staging`
- `.github/workflows/fly-deploy.yml:21` — `--app remember-production` → `--app itdocsnow-production`
- `.run/health-alert-worker/wrangler.toml:1` — `name = "remember-health-alert"` → `name = "itdocsnow-health-alert"`

Verify: `git grep -E "remember-staging|remember-production|remember-health-alert"` returns empty.

---

## 2. Google Cloud project + service account

One project per client. Pick a name matching the client (e.g. `itdocsnow-member-sheets`).

```sh
gcloud projects create itdocsnow-member-sheets --name="ItDocsNow Sheets"
gcloud config set project itdocsnow-member-sheets

# Enable the three APIs
gcloud services enable sheets.googleapis.com drive.googleapis.com docs.googleapis.com

# Create the SA — name matches the convention from the existing deployment
gcloud iam service-accounts create remember-sheets \
  --display-name="ItDocsNow Sheets/Drive/Docs"

# Create a JSON key — the PEM equivalent goes into GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY
gcloud iam service-accounts keys create ./sa-key.json \
  --iam-account=remember-sheets@itdocsnow-member-sheets.iam.gserviceaccount.com

# Enable Domain-Wide Delegation. The numeric Client ID (visible in the console
# after this) is what Phase 5 needs.
gcloud iam service-accounts update remember-sheets@itdocsnow-member-sheets.iam.gserviceaccount.com \
  --enable-domain-wide-delegation
```

**Outputs to capture:**
- SA email: `remember-sheets@itdocsnow-member-sheets.iam.gserviceaccount.com`
- Numeric Client ID (after DWD enable): from IAM console → Service Accounts → the SA → Advanced settings → "Show domain-wide delegation" → copy the `oauth2ClientId`
- JSON key path: `./sa-key.json` (or wherever you put it)

Verify: `gcloud iam service-accounts describe remember-sheets@itdocsnow-member-sheets.iam.gserviceaccount.com` returns an `oauth2ClientId` field that's a large number.

### 2a. If `gcloud iam service-accounts keys create` is denied

Some orgs enforce `iam.disableServiceAccountKeyCreation` (or its managed sibling `iam.managed.disableServiceAccountApiKeyCreation`) at the organization level. The error is:

```
ERROR: Key creation is not allowed on this service account.
type: constraints/iam.disableServiceAccountKeyCreation
```

Why it happens: security-conscious orgs ban static SA keys because they can't be revoked without re-deploying the app. This is a **defensible security posture** — don't fight it, work around it.

**Workaround (one-time per project):**

1. **Grant the deploying party `roles/orgpolicy.policyAdmin` at the organization level.** In your browser:
   ```
   https://console.cloud.google.com/iam-admin/iam?orgonly=true&organizationId=<your-org-id>
   ```
   Click **Grant access** → principal = your deploying-party user → role = **Organization Policy Administrator**. The org ID is in the URL when you visit any GCP page for a project under that org.

2. **Override the constraint at the project level** (limits the override to this project only — doesn't weaken org-wide policy):
   ```sh
   # The simple constraint — disable via project-level override
   cat > /tmp/disable-key-policy.json <<'EOF'
   {
     "name": "projects/<project-id>/policies/iam.disableServiceAccountKeyCreation",
     "spec": {
       "rules": [{"enforce": false}]
     }
   }
   EOF
   gcloud org-policies set-policy /tmp/disable-key-policy.json --project=<project-id>

   # The managed constraint — same syntax, different name
   cat > /tmp/disable-managed-policy.json <<'EOF'
   {
     "name": "projects/<project-id>/policies/iam.managed.disableServiceAccountKeyCreation",
     "spec": {
       "rules": [{"enforce": false}]
     }
   }
   EOF
   gcloud org-policies set-policy /tmp/disable-managed-policy.json --project=<project-id>

   # The managed API-key-binding constraint (visible in some orgs' console)
   cat > /tmp/disable-api-key-policy.json <<'EOF'
   {
     "name": "projects/<project-id>/policies/iam.managed.disableServiceAccountApiKeyCreation",
     "spec": {
       "rules": [{"enforce": false}]
     }
   }
   EOF
   gcloud org-policies set-policy /tmp/disable-api-key-policy.json --project=<project-id>
   ```

   You may see a warning about "Operation not recommended by org policy" — that's the org admin's signal that they should review your override. Safe to ignore.

3. **Retry the key creation:**
   ```sh
   gcloud iam service-accounts keys create ./sa-key.json \
     --iam-account=remember-sheets@itdocsnow-member-sheets.iam.gserviceaccount.com
   ```

4. **Document the override in the project description** so the next person doesn't undo it:
   ```sh
   gcloud projects describe itdocsnow-member-sheets --format='value(name)'
   # Add a note in the project's "Description" field in the GCP console
   ```

**Storage of the key:** once created, do not leave `sa-key.json` on the deploying party's laptop. Move it to a password-manager-backed secret store (Bitwarden, 1Password) — see §9b below.

**Key rotation:** quarterly. Old key → `gcloud iam service-accounts keys delete <KEY_ID> --iam-account=...`. New key → set as `GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY` Fly secret → redeploy.

### 2b. Storing the key locally (Bitwarden / 1Password)

The deploying party should never have `sa-key.json` in plaintext on disk after the Fly secret is set. Two recommended patterns:

**Bitwarden CLI (`bw`):**
```sh
# In your local terminal (bw needs a TTY for password input)
export BW_SESSION="$(bw unlock --raw)"

# Create a folder for the deployment (one per client)
FOLDER_ID=$(bw create folder '{"name":"itdocsnow-member"}' | jq -r .id)

# Create the item shell — no fields yet
ITEM_JSON=$(jq -nc \
  --arg name "gcp-sa-key-itdocsnow" \
  --arg folderId "$FOLDER_ID" \
  --arg notes "Service account JSON key for remember-sheets@<project>.iam.gserviceaccount.com. Attached file is the raw key from gcloud iam service-accounts keys create." \
  '{type: 1, name: $name, folderId: $folderId, notes: $notes, fields: []}')
ITEM_ENC=$(printf '%s' "$ITEM_JSON" | bw encode)
ITEM_ID=$(bw create item "$ITEM_ENC" | jq -r .id)

# Upload the key file as an attachment (preferred over custom fields for binary/large data)
bw create attachment --file ./sa-key.json --itemid "$ITEM_ID" | jq -r .id > /tmp/sa-key-attachment-id

bw sync
```

Retrieval (later, when setting Fly secrets):
```sh
ATTACHMENT_ID=$(cat /tmp/sa-key-attachment-id)
bw get attachment "$ATTACHMENT_ID" --itemid "$ITEM_ID" --output /tmp/sa-key.json
fly secrets set GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY="$(jq -r .private_key /tmp/sa-key.json)" -a <app>-staging
shred -u /tmp/sa-key.json
```

**Bitwarden (UI):** same flow — create the item in the folder, attach the JSON file as a file attachment. The BW UI renders attachments as encrypted blobs; you can right-click → download when needed.

**1Password CLI (`op`):**
```sh
op create item login \
  --title="GCP SA Key — itdocsnow" \
  --vault="Re:Member Deploys" \
  sa-key.json=@./sa-key.json
```

Retrieval: `op read "op://Re:Member Deploys/GCP SA Key — itdocsnow/sa-key.json" | jq -r .private_key` → Fly secret.

**Either pattern eliminates the plaintext-on-laptop risk** without changing the Fly secrets model. The credentials live in an encrypted vault with MFA + audit log; the deploying party's laptop is a client of that vault, not a store.

---

## 3. Google Workspace preparation

- Confirm a real Workspace exists on the target domain. **Cloud Identity free tier does have admin.google.com API Controls** — DWD can be authorized there (the playbook's older note about Cloud Identity free tier was wrong; Cloud Identity supports DWD).
- Create or confirm the impersonation user (the mailbox the SA will send as). A shared mailbox (`it-admin@<client-domain>`) is preferred over a personal human's primary mailbox.

### 3a. Impersonation user setup (the service-account target)

The impersonation user is **never logged into by a human** — it's the `subject` claim that the Re:Member service account puts into its JWT. Because DWD authenticates the SA via its own private key (not via the impersonation user's password), 2-Step Verification is irrelevant for the impersonation user.

Configure as follows:

1. Create the user: admin.google.com → Directory → Users → Add new user. Display name `IT Admin` (or similar; the email is what matters). Do NOT assign any admin role.
2. Set a long random password (32+ chars). Store in BW if you want — but you'll rarely need it.
3. **Disable 2SV for this specific user.** admin.google.com → Directory → Users → the user → Security → 2-Step Verification → set to "Off". Rationale: this account doesn't log in via browser, so 2SV would just be operational overhead.
4. **Disable password reset requirements / inactivity policy for this user.** admin.google.com → Security → Password management → exclude this user from any forced rotation. Google's inactivity-based password resets can break DWD if the impersonation user's auth lapses.
5. **Revoke any existing OAuth refresh tokens.** Users sometimes accumulate refresh tokens from past admin sessions. admin.google.com → Security → API Controls → revoke any refresh tokens for this user. The DWD path doesn't use refresh tokens.

Verify: `gcloud iam service-accounts get-iam-policy remember-sheets@<project>.iam.gserviceaccount.com` shows the SA exists. The impersonation user setup itself doesn't need an API check — it's a UI-only configuration.

### 3b. Admin user setup (humans who manage the org)

For real admin users (the deploying party + the client's volunteer admin):

- Enforce 2SV org-wide. admin.google.com → Security → 2-Step Verification → Enforcement → On.
- Allow authenticator app + hardware security keys (YubiKey etc.) as 2SV methods.
- Recovery codes: print and store in BW for each admin user.

This is best practice and orthogonal to Re:Member — Re:Member's runtime doesn't care if admins have 2SV.

### 3c. Verify

For itdocsnow.com: confirm `it-admin@itdocsnow.com` exists, has 2SV off, and that `admin@itdocsnow.com` can log into admin.google.com.

Open `https://admin.google.com/ac/security/apicontrols` while logged in as an admin. The "Manage Domain Wide Delegation" link should be visible.

---

## 4. Drive folders + Sheets skeleton

In the target Workspace (Drive at drive.google.com, signed in as `admin@<client-domain>` or equivalent):

**Two top-level folders:**
- `<client>/applications/` — becomes `GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID`
- `<client>/review-docs/` — becomes `GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID`

**One Google Sheet** with these tabs (exact names — code reads them positionally):

| Tab | Columns | Used by |
|---|---|---|
| `Basic Applications` | 16 | `src/lib/google-sheets.ts:34` (`BASIC_APPLICATIONS_SHEET`) |
| `Renewals` | 14 | `src/lib/renewal-sheet.ts:55` (`SHEET_NAME`) |
| `Email log` | 7 | `src/lib/google-sheets.ts:35` (`EMAIL_LOG_SHEET`) |
| `Drive Files` | 6 | `src/lib/drive-files.ts:5` (`DRIVE_FILES_SHEET`) — lazy-created by app on first upload, but pre-create it |

`Advanced Applications` (47 cols) is created by the app on first Pro apply — don't pre-create.

**Share the spreadsheet + both Drive folders with the SA email as Editor.** Drive folder sharing is a manual step (right-click → Share → paste SA email → Editor).

Verify: open the sheet, confirm SA is in the share list with Editor. Open one Drive folder, confirm SA appears in the share list.

---

## 5. Workspace Domain-Wide Delegation

Cross-reference: `docs/runbooks/google-workspace-domain-wide-delegation.md` (full deep-dive).

**Quick path:** as Workspace admin → `https://admin.google.com/ac/security/apicontrols` → **Manage Domain Wide Delegation** → **Add new**:

- **Client ID:** the numeric ID captured in Phase 2
- **OAuth Scopes** (one per line, exactly):
  ```
  https://www.googleapis.com/auth/drive
  https://www.googleapis.com/auth/documents
  https://www.googleapis.com/auth/spreadsheets
  ```

All three scopes are required. Authorising only `drive` will silently break the review-Doc creation.

Verify (after Phase 12 deploy): `fly logs -a itdocsnow-staging | grep impersonating` should show `{"impersonating":true,"subject":"it-admin@<client-domain>"}` on the first upload attempt. 1–2 minutes delay between admin-console save and the SA cache refresh is normal.

---

## 6. Mailgun domain + sending account

Cross-reference: `docs/runbooks/mailgun-setup.md` (full deep-dive).

**Quick path:**

1. Create a Mailgun account under the client's email (or have the client create theirs).
2. Add sending domain `mg.<client-domain>` (e.g. `mg.itdocsnow.com`).
3. Add DNS records: SPF + DKIM (auto-listed by Mailgun). DMARC is recommended but optional.
4. Capture the Private API key (`key-…`).
5. Save for Phase 9 — the `MAILGUN_*` env vars go in Fly secrets.

Verify: `curl -sS -u "api:$MAILGUN_API_KEY" https://api.mailgun.net/v3/domains/mg.<client-domain>` returns `"status":"active"`.

---

## 7. Stripe products, prices, webhook endpoint

Cross-reference: `docs/runbooks/stripe-first-products.md` (full deep-dive).

**Quick path:**

1. Use the **client's** Stripe account (the deploying party never shares their own — see Phase 0 tenancy).
2. Create two products: `<Client> Basic Membership` (associate-equivalent) + `<Client> Advanced Membership` (professional-equivalent). Both annual recurring, currency `nzd`.
3. For each product, create two prices:
   - Application price (one-time at apply time) → `STRIPE_PRICE_<N>`
   - Renewal price (recurring annual) → `STRIPE_PRICE_<N>_RENEWAL`
4. Capture 4 price IDs.
5. Create two webhook endpoints (staging + production) — see `stripe-first-products.md §4` for the URL pattern + 6 event types. Capture 2 signing secrets.

**Numbering:** use the enumerated convention. Phase 0's table maps tier slug → N. For itdocsnow.com with `basic` and `advanced`: `STRIPE_PRICE_1`, `STRIPE_PRICE_2`, plus `_RENEWAL` variants.

Verify: `curl -sS https://itdocsnow-staging.fly.dev/api/health | jq '.renewal_prices'` shows both `advanced` and `basic` with `"ok": true` and the priceId you captured.

---

## 8. Cloudflare account + health-alert Worker

Cross-reference: `docs/runbooks/cloudflare-worker-deploy.md` (full deep-dive).

**Quick path:**

```sh
cd .run/health-alert-worker

# `name` field in wrangler.toml was renamed in Phase 1
npx wrangler login
npx wrangler deploy
# Output: https://<client>-health-alert.<account-subdomain>.workers.dev

# Set the 5 secrets
printf "%s" "https://<client-domain>/api/health" | npx wrangler secret put TARGET_URL
printf "%s" "production" | npx wrangler secret put TARGET_NAME
printf "%s" "<Client Display Name>" | npx wrangler secret put ORG_NAME
printf "%s" "<slack-webhook-url>" | npx wrangler secret put SLACK_WEBHOOK_URL
openssl rand -hex 32 | npx wrangler secret put CHECK_TOKEN
```

Save the `CHECK_TOKEN` value — Phase 10 needs it as `REMEMBER_HEALTH_CHECK_TOKEN` (GH secret). The two values must match exactly.

Verify: `curl -X POST -H "Authorization: Bearer $CHECK_TOKEN" https://<client>-health-alert.<sub>.workers.dev/check` returns 200 + `{"checked":1,"failed":0}`.

---

## 9. Fly app bootstrap (staging + production)

Cross-reference: `docs/runbooks/fly-app-bootstrap.md` (full deep-dive, including the migration path from old env-var names).

**Quick path:**

```sh
# Install + auth (one-time)
brew install flyctl
fly auth signup             # first time
fly auth login              # subsequent

# Per-client Fly org
fly orgs create itdocsnow-member
fly orgs switch itdocsnow-member

# Two apps inside the org
fly apps create itdocsnow-staging --org itdocsnow-member
fly apps create itdocsnow-production --org itdocsnow-member

# Set all 23+ secrets in one shot
fly secrets set -a itdocsnow-staging \
  ORG_NAME="ItDocsNow Member Services" \
  SUPPORT_EMAIL="membership@itdocsnow.com" \
  ADMIN_EMAIL="admin@itdocsnow.com" \
  PUBLIC_ORG_URL="https://itdocsnow.com" \
  PUBLIC_APP_URL="https://itdocsnow-staging.fly.dev" \
  STAGING_APP_URL="https://itdocsnow-staging.fly.dev" \
  PROD_APP_URL="https://itdocsnow.com" \
  STRIPE_SECRET_KEY="sk_test_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  STRIPE_PRICE_1="price_..." \
  STRIPE_PRICE_2="price_..." \
  STRIPE_PRICE_1_RENEWAL="price_..." \
  STRIPE_PRICE_2_RENEWAL="price_..." \
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL="remember-sheets@itdocsnow-member-sheets.iam.gserviceaccount.com" \
  GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY="$(cat sa-key.json | jq -r .private_key)" \
  GOOGLE_SHEETS_SPREADSHEET_ID="..." \
  GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID="..." \
  GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID="..." \
  GOOGLE_WORKSPACE_IMPERSONATE_USER="it-admin@itdocsnow.com" \
  MAILGUN_API_KEY="key-..." \
  MAILGUN_DOMAIN="mg.itdocsnow.com" \
  MAILGUN_FROM="ItDocsNow <no-reply@mg.itdocsnow.com>"
```

Run the same block with `-a itdocsnow-production` and live Stripe keys (`sk_live_…`).

Verify: `fly secrets list -a itdocsnow-staging` shows ≥ 23 keys, no `value` printed.

---

## 10. GitHub repo + Actions secrets

Cross-reference: `docs/runbooks/github-actions-bootstrap.md` (full deep-dive).

**Quick path:**

```sh
# Fly token (classic PAT, fine for org-level secret)
fly auth token
```

Add to the client's fork at **Settings → Secrets and variables → Actions**:

| Type | Name | Value |
|---|---|---|
| Secret | `FLY_API_TOKEN` | the `fly auth token` output |
| Secret | `REMEMBER_HEALTH_CHECK_TOKEN` | the same hex value as `CHECK_TOKEN` from Phase 8 |
| Variable | `REMEMBER_HEALTH_ALERT_URL` | the Worker URL from Phase 8 |

Configure the `production` environment (required by `fly-deploy.yml`):
- Settings → Environments → New environment → production
- No additional secrets needed
- Optional: required reviewers for sign-off

Verify: `gh workflow list` shows three workflows. `gh workflow run fly-deploy-staging.yml --ref main` triggers a green deploy.

---

## 11. Per-tier application form requirements

This phase is the single biggest non-obvious onboarding decision. It answers: *for each tier, what fields does the applicant fill, what documents do they upload, what declarations do they tick, before they can pay?*

### Where it lives

Two files per tier schema in `src/lib/forms/schemas/`:

- `<tier>Apply.ts` — engineering-owned: field types, validators, sheet column map, upload doc types, conditional logic
- `<tier>Apply.content.json` — content-owned: labels, placeholders, help text, ordering, the questions themselves

Cross-references:
- `docs/forms/composing-a-form.md` — engineering-owned vs content-owned contract
- `docs/forms/composing-a-tier.md` — the N-tier pattern
- `docs/runbooks/add-a-new-form.md` — creating a new form from scratch
- `docs/runbooks/add-a-new-tier.md` — adding a 3rd tier (extends TIERS + adds `STRIPE_PRICE_3`)

### Per-tier decisions to make

| Decision | Where it lives | Default (advanced) | Default (basic) |
|---|---|---|---|
| Step count | `*Apply.ts` `steps[]` | 8 | 1 |
| Required form sections | `*Apply.ts` `required: true` | 8 (all sections) | 1 (all fields on single step) |
| Number of Y/N questions | `*Apply.content.json` options map | 8 (further requirements) | 0 |
| Number of competencies | `*Apply.content.json` options map | 21 | n/a |
| Number of declarations | `*Apply.content.json` | 8 | 1 (declaration_accuracy) |
| Required document categories | `*Apply.ts` `uploads.docTypes` `required: true` | 6 | 0 |
| Recommended (optional) doc categories | same, `required: false` | 1 (insurance) | 0 |
| Upload max size | `src/pages/api/advanced/upload-file.ts` | 10 MB | n/a |
| Allowed file types | same | PDF, JPEG, PNG, GIF, DOC, DOCX | n/a |
| Renewal form fields | `renew<tier>.ts` + `.content.json` | firstName/lastName/email/phone/year + pdEntries repeatable | firstName/lastName/email/year |

### Steps

1. Open `src/lib/forms/schemas/advancedApply.{ts,content.json}` and `src/lib/forms/schemas/basicApply.{ts,content.json}`. Walk the table above. Replace the ELDAA-specific content (21 competencies, 8 further requirements, 8 declarations, 6 doc types, NZ-specific $ amounts) with the target org's content.
2. If adding a 3rd tier, follow `docs/runbooks/add-a-new-tier.md` end-to-end. Schema-driven + N-tier support mean no other code changes.
3. Re-open the spreadsheet from Phase 4. Adjust column widths, headers, frozen rows to match the new `columnMap`.

Verify: `npm run test` passes (282+ tests). `npm run dev` → browser-render `/apply` and `/advanced/apply`. Confirm conditional fields show/hide, repeatable rows add/remove, document upload works.

---

## 12. First deploy + smoke test

```sh
git add -A
git commit -m "deploy: itdocsnow first cut"
git push origin main
# Auto-triggers fly-deploy-staging.yml
gh run watch
```

When the GH run is green:

```sh
# 1. Health endpoint reports all subsystems connected
curl -sS https://itdocsnow-staging.fly.dev/api/health | jq '.status,.stripe,.email'
# expect: "ok", "connected", "connected"

# 2. Stripe webhook roundtrip
stripe trigger checkout.session.completed
# Expect 200 in Stripe webhook delivery log

# 3. End-to-end apply: open /apply in a browser, fill the basic-apply form
#    with a real test email, submit.
# expect:
#   - Mailgun dashboard shows a delivered message to the test recipient
#   - "Basic Applications" tab has a new row
#   - "Email log" tab has 1+ new rows
#   - "applications/" Drive folder has a subfolder for the applicant id

# 4. Stripe test card
# Use 4242 4242 4242 4242 + future date + any CVC. Pay the application's checkout.
# expect:
#   - Stripe sends the receipt (Stripe owns that)
#   - "review-docs/" folder gains a new Google Doc
#   - Admin notification email arrives at ADMIN_EMAIL
```

If any step fails, Phase 14's verification matrix points back at the phase that owns that subsystem.

---

## 13. itdocsnow.com test pass — concrete values

This section runs the playbook end-to-end with concrete values for the user's first test deployment. Subsequent client deployments follow the same playbook with their own values.

### Pinned values

| Phase | itdocsnow.com value |
|---|---|
| Org name | `ItDocsNow Member Services` |
| Workspace primary domain | `itdocsnow.com` |
| Impersonation user | `it-admin@itdocsnow.com` |
| GCP project | `itdocsnow-member-sheets` |
| SA email | `remember-sheets@itdocsnow-member-sheets.iam.gserviceaccount.com` |
| Mailgun sending domain | `mg.itdocsnow.com` |
| Fly apps | `itdocsnow-staging`, `itdocsnow-production` |
| Fly region | `syd` |
| Worker name | `itdocsnow-health-alert` |
| Public URL | `https://itdocsnow.com` |
| Staging URL | `https://itdocsnow-staging.fly.dev` |
| Drive folder names | `itdocsnow/applications/`, `itdocsnow/review-docs/` |
| Sheet name | `ItDocsNow Member Test` |
| Stripe currency | `nzd` |
| Stripe tier numbering | 1 = basic, 2 = advanced |

### Acceptance criteria

Test pass is complete when:

1. Health endpoint on staging returns `{status:"ok",stripe:"connected","email":"connected",renewal_prices:{advanced:{ok:true},basic:{ok:true}}}`
2. A `4242 4242 4242 4242` test payment lands as a row in `Basic Applications`, a row in `Renewals`, a Google Doc in `itdocsnow/review-docs/`, and a row in `Email log`
3. Resume-link email to a Mailgun-verified recipient arrives in <60s with working URL
4. Cloudflare Worker cron (5 min) runs without Slack alerts after the first hit
5. Forced failure (`fly secrets set STRIPE_SECRET_KEY=sk_test_invalid` then back) posts exactly one Slack alert then goes quiet
6. All 13 verification matrix rows green (Phase 14)

---

## 14. Verification matrix

Run these in order at the end of the test pass as final sign-off.

| # | Phase | Verification command | Pass signal |
|---|---|---|---|
| 1 | Clone & rename | `git grep -E "remember-staging\|remember-production\|remember-health-alert"` | empty |
| 2 | GCP + SA | `gcloud iam service-accounts describe remember-sheets@<project>.iam.gserviceaccount.com` | non-empty `oauth2ClientId` |
| 3 | Workspace | open `https://admin.google.com/ac/security/apicontrols` | "Manage Domain Wide Delegation" link visible |
| 4 | Drive + Sheets | open spreadsheet + folders, check share list | SA appears with Editor on all 4 tabs + 2 folders |
| 5 | Workspace DWD | `fly logs -a <app>-staging \| grep impersonating` (after first upload) | `{"impersonating":true,...}` |
| 6 | Mailgun | `curl -sS -u "api:$KEY" https://api.mailgun.net/v3/domains/<domain>` | `"status":"active"` |
| 7 | Stripe | `stripe trigger checkout.session.completed` + check webhook log | 200 in webhook delivery log |
| 8 | Cloudflare Worker | `curl -X POST -H "Authorization: Bearer $TOKEN" <worker>/check` | HTTP 200 + `{"checked":1,"failed":0}` |
| 9 | Fly secrets | `fly secrets list -a <app>-staging \| wc -l` | ≥ 23 keys listed |
| 10 | GitHub Actions | `gh run list --workflow=fly-deploy-staging.yml --limit 1` | status=completed, conclusion=success |
| 11 | Form content | `npm run test` + browser-render `/apply` + `/advanced/apply` | 282+ tests pass; conditional fields work |
| 12 | Smoke test | `curl -sS https://<app>-staging.fly.dev/api/health` | `{status:"ok",stripe:"connected",email:"connected"}` |
| 13 | End-to-end | apply + pay + check sheet rows + check inbox | row in `Basic Applications` + `Email log`, doc in `review-docs/` |

---

## 15. Rollback / re-run

The playbook is **idempotent** for most phases — re-running with new values overwrites secrets. The exceptions:

- **Phase 5 (Workspace DWD)** — re-adding the same Client ID is safe; adding a different one requires manual removal of the old entry.
- **Phase 7 (Stripe webhook endpoint)** — duplicate endpoints both receive events; delete the old one in the dashboard before re-creating.
- **Phase 11 (form content)** — already-deployed applicants reference the old schema's `columnMap`. Re-deploying a new schema against an existing sheet is OK if column letters don't shift; if they do, run a sheet migration first.

### Per-key rollback (Phase 9 secrets)

```sh
fly secrets unset <KEY> -a <app>-staging
fly secrets set   <KEY>=<new-value> -a <app>-staging
```

Redeploy is automatic on next push to `main`. For an immediate deploy without a code change:

```sh
fly deploy -a <app>-staging --remote-only
```

### Worker rollback (Phase 8)

```sh
npx wrangler rollback                          # revert to previous deployment
npx wrangler secret put CHECK_TOKEN            # rotate (also update GH secret in Phase 10)
npx wrangler delete                            # last resort
```

### Migrating from old env-var names

If you inherit an app previously deployed with `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_ADVANCED` (or pre-rename `STRIPE_PRICE_PROFESSIONAL` / `STRIPE_PRICE_ASSOCIATE`):

```sh
fly secrets unset -a <app>-staging \
  STRIPE_PRICE_BASIC STRIPE_PRICE_ADVANCED \
  STRIPE_PRICE_BASIC_RENEWAL STRIPE_PRICE_ADVANCED_RENEWAL \
  STRIPE_PRICE_PROFESSIONAL STRIPE_PRICE_ASSOCIATE \
  STRIPE_PRICE_PROFESSIONAL_RENEWAL STRIPE_PRICE_ASSOCIATE_RENEWAL

fly secrets set -a <app>-staging \
  STRIPE_PRICE_1=<priceId> STRIPE_PRICE_2=<priceId> \
  STRIPE_PRICE_1_RENEWAL=<priceId> STRIPE_PRICE_2_RENEWAL=<priceId>
```

Push to trigger redeploy. Verify with `fly secrets list -a <app>-staging | grep STRIPE_PRICE` showing only the four new names.