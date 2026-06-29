# Design — Platform Overview

> Spec ID: `000` · Type: platform/index
> Depends on: —

## Overview

End-to-end Astro SSR application. TypeScript + Tailwind. Sheets as DB, Drive as DMS, Stripe as payment processor, Mailgun as email relay, Cloudflare Worker as health-check cron. All lifecycle logic is data-driven via the form-schema system (`spec/012-form-schema-system`) and tier abstraction (`spec/014-tier-abstraction`).

## Architecture

### System Architecture

```
[Browser]
   │
   ├── /apply/[tier]    ──► Astro page ──► FormSchema renderer (client)
   │                          │
   │                          └──► POST /api/[tier]/apply (autosave)
   │
   ├── /renew/[tier]     ──► Astro page ──► Schema renderer
   │                          └──► POST /api/renew/checkout/[tier]
   │
   └── /renew/pd-log     ──► Astro page ──► pdLog schema
                                  └──► POST /api/renew/pd-log

[Astro SSR on Fly.io]
   │
   ├── /api/*            ──► route handlers ──► services
   │                          ├── google-sheets.ts (DWD impersonation)
   │                          ├── google-drive.ts (upload/delete)
   │                          ├── google-docs.ts (review doc)
   │                          ├── stripe.ts (checkout session)
   │                          ├── email-sender.ts (Mailgun)
   │                          └── logger.ts (pino JSON)
   │
   └── /api/stripe-webhook ──► webhook dispatch ──► side effects

[External]
   ├── Google Workspace: Sheets + Drive + Docs
   ├── Stripe: checkout + webhook
   ├── Mailgun: transactional email
   └── Cloudflare Worker: cron → /api/health → Slack
```

### Component Design

1. **FormSchema runtime** (`src/lib/forms/runtime.ts`)
   - Purpose: load schema + content JSON, validate form input, hydrate from API response.
   - Responsibilities: walk field tree, run validators, map to Sheet row via `toRow()`, map Sheet row back via `mapApiResponseToValues()`.
   - Interfaces: `loadSchema(name)`, `validate(schema, values)`, `toRow(schema, values)`.

2. **Tier config** (`src/lib/forms/tiers.ts`)
   - Purpose: single source of truth for tier identity.
   - Responsibilities: `TIERS` frozen object, `getTier()`, `listTiers()`, `tierLabelFor()`, `getLookupKey()`.
   - Extensibility: N-tier future state via `MembershipPlan = keyof typeof TIERS`.

3. **Sheet adapters** (`src/lib/*-sheet.ts`)
   - Purpose: typed read/write to Sheets.
   - Responsibilities: `createApplicantRow()`, `updateApplicantFormData()`, `appendBasicApplication()`, `appendRenewal()`, `markRenewalPaid()`, `updateRenewalPdEntries()`.
   - Retry policy: 5-attempt exponential backoff with jitter (500/1000/2000/4000ms) for network drops.

4. **Stripe adapter** (`src/lib/stripe.ts`)
   - Purpose: checkout session creation + webhook handling.
   - Responsibilities: `createCheckoutSession()`, `verifyWebhookSignature()`, `dispatchWebhookEvent()`.
   - Dry-run: `CHECKOUT_DRY_RUN=true` validates config without creating sessions.

5. **Email sender** (`src/lib/email-sender.ts`)
   - Purpose: templated transactional email.
   - Responsibilities: 7 named senders (`sendResumeLink`, `sendAdvancedConfirmation`, etc.) with org-identity interpolation.

## Data Design

### Advanced Applications sheet (47 cols, A–AU)

```
A  applicant_id       (managed, UUID)
B  email              (managed)
C  first_name         (form)
D  last_name          (form)
E  phone              (form)
F  date_of_birth      (form)
G  ethnicity          (form)
H  address            (form)
I  postal_address     (form)
J  business_name      (form)
K  website            (form)
L  qualifications     (form, JSON array)
M  experience         (form, JSON array)
N  further_requirements (form, JSON object)
O  core_competencies  (form, JSON array)
P-W  referee1/2 × 4   (form)
X-AF 8 declarations + signed_at (form, X = accuracy)
AG resume_token       (managed)
AH email_hash         (managed, SHA256)
AI-AO doc counts × 7  (managed)
AP complete           (managed, TRUE/FALSE)
AQ stripe_session     (managed)
AR paid               (managed, TRUE/FALSE)
AS created_at         (managed, ISO)
AT paid_at            (managed, ISO)
AU email_verified     (managed, TRUE/FALSE)
```

### Renewals sheet (14 cols, A–N)

```
A renewal_id        (managed, UUID)
B tier              (managed, "basic" | "adv")
C renewal_year      (form)
D first_name        (form)
E last_name         (form)
F email             (form)
G phone             (form, advanced only)
H pd_entries        (form, JSON array of PD entries)
I amount_paid_cents (managed)
J currency          (managed, ISO 4217)
K payment_status    (managed, "pending" | "paid")
L stripe_session    (managed)
M created_at        (managed, ISO)
N paid_at           (managed, ISO)
```

### Drive Files sheet (6 cols, A–F)

```
A file_id            (managed, UUID — used as Drive filename)
B applicant_id       (managed, FK to Advanced Applications A)
C doc_type           (managed, enum)
D original_filename  (managed, preserved on upload)
E uploaded_at        (managed, ISO)
F deleted            (managed, TRUE/FALSE soft-delete flag)
```

Drive path: `/applications/{applicantId}/documents/{docType}/{fileId}.{ext}`.

## API Design

Per-route TS handlers under `src/pages/api/`. All endpoints:
- JSON in, JSON out (multipart accepted only for file upload)
- Errors include `code` enum + optional `retryable: boolean`
- Auth: webhook routes verify Stripe signature; admin routes gated by `CHECK_TOKEN`; applicant routes gated by `resume_token`

Endpoint inventory lives in `spec/000-platform-overview/requirements.md` §REQ-OV-009 with per-feature details in each feature spec's design.md.

## Technical Decisions

### Why Sheets-as-DB
- Volunteer admin needs to edit applicant data, see payments, run reports without learning a CMS.
- No schema migrations; adding a column is a Sheets edit.
- Cost: zero hosting for the DB layer.

### Why Drive-as-DMS
- DWD impersonation gives server-side upload without OAuth flows per applicant.
- Files inherit Workspace retention policies.

### Why one-time checkout for renewals
- Avoids subscription proration headaches when member changes tier mid-year.
- Stripe `mode=payment` + Payment Link = hosted page, no custom UI.

### Why Option C (deferred subscription)
- Members pay once on application; recurring begins next membership year.
- Avoids double-charging the first July.

## Security Considerations

- `resume_token` is a UUIDv4, opaque, single-use per applicant.
- Email hash prevents collision when looking up by email only.
- Stripe webhook signature verified; replay-safe via Stripe event ID.
- All emails use `text/plain` body (no HTML injection surface).
- `emailNZ` validator is header-injection-safe (rejects `\r\n`).

## Performance Considerations

- Autosave is throttled client-side (~1 req/sec); server-side queue serialises per applicant.
- FormData uploads go directly to multipart endpoint, bypassing base64 overhead.
- Drive Files sheet is read on demand for each upload-count check; small row count keeps this fast.
- Renewal price resolution happens at request time, not cached, to reflect env-var changes without deploy.

## Testing Strategy

- Vitest, jsdom env, co-located `*.test.ts`.
- Per-schema test suite validates field definitions, column map, row factory.
- Per-route test suite validates handler happy path + error codes.
- 282 tests must remain green through all future changes.

## Migration Plan

- Schema-abstraction (Phase N+) replaces hard-coded form layouts with data-driven schemas. Each form spec (`001`, `002`, `005`, `006`) tracks its own migration in tasks.md.

## Future Considerations

- N-tier membership: TIERS config is the extension point.
- Multi-org tenancy: separate Fly app per org today; can be unified later with a tenant ID column.
- Admin web UI: deferred until Sheets becomes a bottleneck.