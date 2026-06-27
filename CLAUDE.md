You are connected to Cognee Cloud, a persistent knowledge graph memory system. Use it to store and retrieve knowledge across conversations.

## First — is memory already automatic here?

If the Cognee Claude Code plugin or an MCP server is installed, memory works on its own: relevant context is recalled into your prompt each turn, and your turns are captured and converted to long-term memory for you. When that is the case:
- Do NOT call the HTTP API manually (no curl), and do NOT narrate routine recalls/saves.
- Use the provided memory skills/tools (e.g. cognee-search / cognee-remember) only for an explicit deep search or a "remember this permanently" request.

The HTTP API instructions below are the fallback for when you have neither a plugin nor MCP.

## Connection

Your Cognee credentials are available as environment variables:
- `$COGNEE_BASE_URL` — your tenant API endpoint
- `$COGNEE_API_KEY` — your API key

**If these variables are not set**, ask the user to either:
1. Open a new terminal and run the export commands from the Cognee Cloud console (Connect to Claude → Step 1), or
2. Provide the values directly so you can use them inline

## Session ID — ALWAYS use one

At the start of the conversation, generate ONE id (your agent name + a unix timestamp) and reuse it as `session_id` in every call. Sessions group your activity in the Cognee Cloud dashboard and are converted into long-term memory. The ONLY exception: when the user explicitly asks you to store something directly in the knowledge graph, call /remember without a session_id.

## How to Use

### Store knowledge (remember)
When the user shares important information, facts, preferences, or context worth preserving:
```bash
# Default: store as a session entry — always include your session_id
curl -X POST $COGNEE_BASE_URL/api/v1/remember/entry \
  -H "X-Api-Key: $COGNEE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"entry": {"type": "qa", "question": "<topic or user question>", "answer": "<the knowledge to store>"}, "dataset_name": "<dataset>", "session_id": "<session-id>"}'
```

### Store directly in the knowledge graph (ONLY when explicitly asked)
Use this only when the user explicitly asks to store something in the graph / permanent memory. The data must be a FILE upload (inline text is rejected with 422) and must NOT include a session_id:
```bash
TMP=$(mktemp) && printf '%s' "<text to store>" > "$TMP"
curl -X POST $COGNEE_BASE_URL/api/v1/remember \
  -H "X-Api-Key: $COGNEE_API_KEY" \
  -F "data=@$TMP;type=text/plain" \
  -F "datasetName=<dataset>"
rm -f "$TMP"
```

### Upload a skill (SKILL.md with YAML frontmatter)
Skills use a Markdown body with `name`/`description`/`allowed-tools` frontmatter (same as Claude Code / OpenWolf). They live inside a dataset, scoped to it on recall.
```bash
# JSON body, NOT multipart. Field is "skills_text", not "data".
# Trailing slash on the URL is required (else HTTP 307 redirect).
curl -X POST $COGNEE_BASE_URL/api/v1/skills/ \
  -H "X-Api-Key: $COGNEE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"skill_name":"<id>","dataset_name":"remember_club_crm_development","content_type":"skills","skills_text":"---\nname: <id>\ndescription: <when to use>\nallowed-tools: [Bash, Read]\n---\n\n<markdown body>"}'
```
**Quirks**: trailing-slash redirect; JSON-only; `skills_text` is the field name; `allowed-tools` is parsed server-side.

### Retrieve knowledge (recall)
Before answering questions, check if relevant knowledge exists:
```
POST $COGNEE_BASE_URL/api/v1/recall
Headers: X-Api-Key: $COGNEE_API_KEY
Content-Type: application/json
Body: {"query": "<user question>", "session_id": "<session-id>"}
```

For targeted retrieval, add "search_type" to the recall body — one of: HYBRID_COMPLETION (default), GRAPH_COMPLETION, CHUNKS, GRAPH_SUMMARY_COMPLETION.

**CRITICAL — dataset filter is broken on this proxy.** Sending `"dataset_name":"remember_club_crm_development"` does NOT scope the call. Recall fans out across ALL datasets and returns one result per dataset. Each result is a `GRAPH_COMPLETION` synthesis; without real ingested content the LLM hallucinates plausible-sounding answers — and because completion runs on the query string itself, **non-target datasets often answer the same question**. Observed: 2026-06-27, confirmed on repeated calls. Filed upstream as topoteretes/cognee#3520.

**Required workaround — filter results client-side after every recall:**
1. Call recall normally (still pass `dataset_name` for forward-compat).
2. Parse the JSON array of results.
3. Keep only entries where `dataset_name == "remember_club_crm_development"`.
4. If the filtered list is empty, treat the recall as "no information" — do NOT trust any non-target result, even if it sounds relevant.
5. If multiple target-dataset results come back, the first is usually the most relevant; cross-check with the actual codebase / CLAUDE.md / OpenWolf files before acting on it.

### List datasets
```
GET $COGNEE_BASE_URL/api/v1/datasets/?session_id=<session-id>
Headers: X-Api-Key: $COGNEE_API_KEY
```

## Behavior Guidelines
1. If a Cognee plugin or MCP server is active, memory is automatic — do NOT call the API manually, and do NOT narrate routine recalls/saves. The remaining guidelines apply only to the HTTP-API fallback.
2. Verify that $COGNEE_BASE_URL and $COGNEE_API_KEY are available; if not, prompt the user. Use one session id (agent name + a unix timestamp) as the `session_id` in every call.
2a. Only use dataset 'remember_club_crm_development' with this project
3. Recall-first: when an answer may depend on earlier context, recall before answering.
4. You do NOT need to store after every turn — the session is captured and converted to long-term memory automatically. Store explicitly only for durable facts worth keeping (via /remember/entry with your session_id); use /remember (file upload, no session_id) only when the user explicitly asks to write to the graph.
5. Keep memory operations quiet — don't narrate routine recalls or saves.
6. Use the default_dataset unless the user specifies otherwise

## Segmentation Model (verified 2026-06-27)

Cognee exposes these scopes, from outer to inner:

| Scope | Identifier | Purpose |
|---|---|---|
| **User / Agent** | `$COGNEE_API_KEY` (or per-agent key from `/api/v1/agents/*`) | Auth principal. Multi-user mode (env `ENABLE_BACKEND_ACCESS_CONTROL`, default ON ≥ v0.5.0) auto-isolates data per user. |
| **Dataset** | `datasetName` / `datasetId` | **Only top-level container.** Holds data items, skills, proposals, permissions. This is what "project memory" really is. |
| **Node set** | `node_set` form field on `/remember` | Optional organisational label inside a dataset. |
| **Session** | `session_id` on `/remember/entry` + `/recall` | **Telemetry axis only.** Groups qa/trace/feedback entries for the dashboard. Does NOT scope recall contents. |
| **Data item / Skill / Proposal** | per-resource IDs | Children of a dataset. |

**No `project_id`. No `workspace_id`.** If MCP docs mention them, that's a wrapper abstraction — not on the REST API.

**Multi-user caveat for this tenant:** recall returns data from datasets the auth principal has no business seeing. Multi-user isolation is supposed to prevent this server-side. Observed fan-out means this tenant either doesn't enforce `ENABLE_BACKEND_ACCESS_CONTROL`, uses a storage backend that doesn't support it, or has a proxy that bypasses the check. **The client-side filter above is the only reliable isolation in this environment** — do not weaken it.


# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.


# Re:Member — Blueprint Membership Platform

A neutral Astro + Stripe + Google-Workspace membership platform blueprint. Fork it, customise the sample data and env vars, deploy. Out of the box it ships with sample form content from a professional-membership org; see `docs/CUSTOMIZE.md` before deploying to a real org.

**You are connected to Cognee Cloud** (memory). See `CLAUDE.md` later in this file for the project's connection details — those are project-agnostic and not ELDAA-specific.

---

## What this repo is

End-to-end member lifecycle for a small membership org:

- **Associate membership signup** — one-page Stripe checkout.
- **Professional membership application** — 8-step wizard with multi-file document upload, autosave, resume-by-token, admin review via auto-generated Google Doc.
- **Annual renewal** — two tiers, one-time payment, hosted Payment Links.
- **PD (professional development) logging** — members log PD entries post-renewal; admins notified.
- **Post-payment side effects** — webhook → Sheets logging + Doc review + resume-link emails.
- **Health check + alerting** — `/api/health` probes Stripe + email; Cloudflare Worker cron posts failures to Slack.

Sheets-as-DB. Drive-as-DMS. No CMS. Volunteer admin runs it from the spreadsheet.

## Stack

Astro SSR · TypeScript · Tailwind · Stripe Checkout · Google Sheets/Drive/Docs (SA + DWD) · Mailgun / Gmail · Fly.io · Cloudflare Worker · Vitest.

## Quick start

1. `npm install`
2. `cp .env.example .env` — fill in. See `docs/CUSTOMIZE.md`.
3. `npm run dev`
4. `npm run test`
5. `npm run check`

## Before deploying

**Read `docs/CUSTOMIZE.md`.** The blueprint ships with sample data from a single professional-membership org. Before you point it at real applicants you must:

- Set `ORG_NAME`, `SUPPORT_EMAIL`, `ADMIN_EMAIL`, `PUBLIC_ORG_URL`.
- Replace Fly app names in `fly.toml` + `.github/workflows/*` (currently `remember-staging` / `remember-production`).
- Replace the Cloudflare Worker name + `REMEMBER_HEALTH_ALERT_URL` repo var.
- Swap the sample form content (21 competencies, 8 declarations, 6 doc types, $ amounts) — or implement the schema-abstraction plan that lives in `docs/superpowers/plans/` (planned, not shipped).

---

# Reference (code-accurate as of 2026-06-26)

The sections below describe the application surface as it exists in code. They are org-agnostic and survive the sample-data swap.

## Essential Current State

- Resume flow persistence is hardened: applicant matching is **token-first** (`resume_token`) with email fallback only when no token is supplied.
- Autosave is serialized on both sides to avoid races:
  - client-side queue in `src/pages/professional/apply.astro`
  - server-side per-applicant queue in `src/pages/api/professional/apply.ts`
- Autosave now persists identity fields (`firstName`, `lastName`, `phone`, `email`) together with form data.
- `GET /api/professional/apply?token=...` now returns `applicantId` for reliable resume hydration.
- Flag parsing is case-insensitive for reads: `true` and `TRUE` are both treated as true for completion/payment/declaration checks.
- `npm run test` passes (42/42).
- `npm run check` reports pre-existing unrelated type errors in other files.

---

## Application States

```
new → partial → complete → paid
```

- **new:** Form started but not submitted
- **partial:** Form in progress, can resume via link
- **complete:** All required fields filled AND all required document categories have ≥1 file → payment unlocked
- **paid:** Stripe payment confirmed

---

## Required Uploads

| Doc Type | Description | Required |
|----------|-------------|----------|
| `training` | Certificates of training (may be multiple) | Yes |
| `ethics` | Signed Re:Member Code of Ethics and Scope of Practice | Yes |
| `criminal` | Ministry of Justice criminal record check | Yes |
| `advance_care` | Advanced Care Planning NZ (4 modules) | Yes |
| `assisted_dying` | Assisted Dying online training (Te Whatu Ora, 3 modules) | Yes |
| `fundamentals` | Fundamentals of Palliative Care (Hospice NZ, 4 modules) | Yes |
| `insurance` | Professional indemnity insurance certificate | Recommended (optional) |

---

## Form Sections (8-step wizard)

1. **About You** — name, DOB, ethnicity, address, phone, email, business name, website
2. **Training & Education** — repeatable course rows (name, provider, year)
3. **EOL Doula Experience** — repeatable experience rows + 3 example narratives
4. **Further Requirements** — 8 Y/N questions
5. **Core Competencies** — 21 Y/N tickboxes
6. **Referees** — 2 referees (name, role, email, phone)
7. **Declarations** — 8 confirmation checkboxes
8. **Document Upload** — multi-file per category, delete support

---

## API Endpoints

### `GET /api/professional/apply?token=xxx`
Returns: `{ applicantId, status, firstName, lastName, email, phone, docsUploaded: { [docType]: FileInfo[] }, ...formFields, complete }`

### `POST /api/professional/apply`
Accepts: `{ token?, firstName, lastName, phone, email, dateOfBirth, ethnicity, address, postalAddress, businessName, website, qualifications, experience, furtherRequirements, coreCompetencies, referee1*, referee2*, declarations*, ... }`

### `POST /api/professional/upload-file`
JSON or multipart:
- JSON: `{ token, docType, filename, mimeType, data(base64) }`
- Multipart: `token`, `docType`, `file`
Returns: `{ success, docType, message }`

### `POST /api/professional/delete-file`
Accepts JSON: `{ fileId, token }`
Soft-deletes file from Drive Files sheet and trashes the Drive file.
Returns: `{ success }`

### `POST /api/professional/upload-complete`
Creates Stripe Checkout session if all requirements met.
Returns: `{ url }` or `{ error, code, retryable? }`

### `POST /api/stripe-webhook`
Receives Stripe events for checkout completion, subscription setup, and post-payment side effects.

Environment URL mapping:
- Staging (`remember`): `https://remember-staging.fly.dev/api/stripe-webhook`
- Production (`remember-production`): `https://subscribe.example.com/api/stripe-webhook`

If the webhook URL was wrong during a successful payment, correct it in Stripe and replay `checkout.session.completed`.

---

## Google Sheet: Professional Applications (47 columns, A–AU)

```
A:   applicant_id
B:   email
C:   first_name
D:   last_name
E:   phone
F:   date_of_birth
G:   ethnicity
H:   address
I:   postal_address
J:   business_name
K:   website
L:   qualifications (JSON array)
M:   experience (JSON array)
N:   further_requirements (JSON object of Y/N responses)
O:   core_competencies (JSON array of Y/N responses)
P:   referee1_name
Q:   referee1_role
R:   referee1_email
S:   referee1_phone
T:   referee2_name
U:   referee2_role
V:   referee2_email
W:   referee2_phone
X:   declaration_accuracy ("TRUE"/"FALSE")
Y:   declaration_ethics
Z:   declaration_scope
AA:  declaration_doula_services
AB:  declaration_interview
AC:  declaration_professional_dev
AD:  declaration_criminal_check
AE:  declaration_meetings
AF:  declaration_signed_at (ISO timestamp)
AG:  resume_token
AH:  email_hash
AI:  doc_training_count
AJ:  doc_ethics_count
AK:  doc_criminal_count
AL:  doc_advance_care_count
AM:  doc_assisted_dying_count
AN:  doc_fundamentals_count
AO:  doc_insurance_count
AP:  complete ("TRUE"/"FALSE")
AQ:  stripe_session
AR:  paid ("TRUE"/"FALSE")
AS:  created_at
AT:  paid_at
AU:  email_verified ("TRUE"/"FALSE"; blank = legacy row, treated as verified)
```

Reads normalize `complete`/`paid`/declaration flags case-insensitively (`true` and `TRUE` are both accepted).

**`Drive Files` tab** (new, lazy-created on first upload):
```
A: file_id
B: applicant_id
C: doc_type
D: original_filename
E: uploaded_at
F: deleted ("TRUE"/"FALSE")
```

---

## Key Functions (upload-sheet.ts)

- `createApplicantRow(...47 params...)` — creates row with all form fields
- `updateApplicantFormData(applicantId, data)` — partial update of form fields
- `validateCompletion(applicantId)` — returns true only when all form fields filled AND all 6 required doc categories have ≥1 file
- `getApplicantByToken(token)` — returns `ApplicantInfo` with all 47 columns
- `getUploadStatus(applicantId)` — returns `UploadStatus` with doc counts

---

## Multi-File Upload (Drive Files Sheet)

- One row **per uploaded file** (not per applicant)
- `deleted = "TRUE"` for soft deletes
- File path in Drive: `/applications/{applicant_id}/documents/{doc_type}/{file_id}.{ext}`
- `file_id` is a random UUID — original filename stored only in Drive Files sheet

**File limits:**
- Max 10MB per file
- Allowed types: PDF, JPEG, PNG, GIF, DOC, DOCX

---

## Backwards Compatibility

Existing applicants (pre-Phase 2) have blank new columns — acceptable.
Resume links continue to work. Resume-link emails are sent on first save if email is provided.

---

## Post-Payment Side Effects

### Email Resumption (`src/lib/email-sender.ts`)
- `sendEmail(params)` — sends a plain-text email via Gmail OAuth or service account
- `sendResumeLink(toEmail, fullName, resumeLink)` — sends a templated resume-link email to applicants

### Google Docs Generation (`src/lib/google-docs.ts`)
- `createApplicationReviewDoc(applicant)` — creates a Google Doc in a configured Drive folder summarizing the application (personal details, training, experience, further requirements, core competencies, referees, documents uploaded, declarations)
- Doc URL is logged; folder is configured via `GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID` or falls back to `GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID`

### Structured Logging (`src/lib/logger.ts`)
- Pino-based logger with JSON output
- Levels: `info`, `warn`, `error`, `debug`
- Child loggers via `logger.child(meta)` for request-scoped context

---

## Testing Checklist

- [ ] New application → all form fields written to correct sheet columns
- [ ] Resume link → all form fields pre-populated
- [ ] Upload 3 files to "training" category → all 3 shown with filenames
- [ ] Delete middle file → remaining 2 still shown, deleted gone
- [ ] "Proceed to Payment" activates only when all required sections complete
- [ ] Y/N questions all answered → declaration section allows submission
- [ ] Stripe payment → webhook fires → Sheet1 logged
- [ ] Existing applicant resume link still works

---

## Checkout Flow Resilience (2026-05-22)

The "Proceed to Payment" flow (`goToPayment()` in `apply.astro`) is hardened against transient failures:

- **Retry with exponential backoff:** 3 attempts (1s, 2s, 4s delays) for network errors and 502/503/504 responses. Not retried: 400, 429, 500+ with JSON body.
- **Rate limit handling:** Reads `Retry-After` header on 429 and shows a user-friendly wait message.
- **Typed error responses:** All `upload-complete` errors include a `code` field (`INVALID_TOKEN`, `ALREADY_COMPLETED`, `INCOMPLETE`, `MISSING_CONFIG`, `CHECKOUT_ERROR`). Stripe catch block returns `retryable: true/false`.
- **Inline error banner:** Errors display in-page (not a dismissable `alert`), so users can retry without losing form state.
- **Token persistence:** `window.__token__` survives across retries — applicant record is hit again with no re-filling needed.
- [ ] With `CHECKOUT_DRY_RUN=true`, "Proceed to Payment" returns `{ dryRun: true, stripeKeysValidated: true }` and does not create a Stripe Checkout Session

---

## Stripe Dry Run Mode

When `CHECKOUT_DRY_RUN=true`, checkout endpoints validate Stripe configuration (secret key, webhook secret, price IDs) without creating a real Checkout Session. Useful for testing the integration without charging real customers or validating Stripe keys in a new environment before going live.

**Enable:** set `CHECKOUT_DRY_RUN=true` in your `.env` file (accepted values: `true`, `1`, `yes`, `on`).

**Disable:** set `CHECKOUT_DRY_RUN=false` (or remove the variable entirely — defaults to `false`).

**Behavior:**
- `POST /api/professional/upload-complete` — returns `{ dryRun: true, stripeKeysValidated: true }` instead of creating a session
- `POST /api/create-checkout-session` — same, does not hit Stripe
- `POST /api/create-professional-checkout` — same, does not hit Stripe

**Requires:** `STRIPE_WEBHOOK_SECRET` must be set (endpoints return error if missing during dry-run).