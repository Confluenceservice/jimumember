# Customizing Re:Member before deploy

Re:Member ships as a working blueprint with sample form content from a single
professional-membership organisation. Before you point it at real applicants,
walk this list.

## 1. Org identity (env vars)

Set these in `.env` (local) and as Fly secrets in production:

| Var | Purpose | Default in `.env.example` |
|-----|---------|---------------------------|
| `ORG_NAME` | Display name shown in email subjects + bodies | `Re:Member` |
| `SUPPORT_EMAIL` | Reply-To for transactional emails | `membership@example.com` |
| `ADMIN_EMAIL` | Recipient for "new application" + renewal notifications | `admin@example.com` |
| `PUBLIC_ORG_URL` | Public website URL shown in member emails | `https://example.com` |
| `PUBLIC_APP_URL` | App base URL — resume links, PD-log links, redirects | `http://localhost:4321` |
| `STAGING_APP_URL` | Override staging URL (auto-detected via `STAGING_PREFIX`) | `https://staging.example.com` |
| `PROD_APP_URL` | Override production URL (used when `STAGING_PREFIX` unset) | `https://example.com` |

## 2. Fly app names

`fly.toml` ships with `app = 'remember-staging'`. Rename to your staging app:

- `fly.toml:6` — `app = 'remember-staging'`
- `.github/workflows/fly-deploy-staging.yml:14` — `--app remember-staging`
- `.github/workflows/fly-deploy.yml:21` — `--app remember-production` (production)

Create the apps in Fly first (`fly apps create your-app-staging`), then update the files.

## 3. Cloudflare Worker (health alerting)

`.run/health-alert-worker/wrangler.toml` ships with `name = "remember-health-alert"`.
Rename to your worker name, then in the Worker dashboard set secrets:

| Worker secret | Purpose |
|---------------|---------|
| `TARGET_URL` | `https://your-app.example/api/health` |
| `TARGET_NAME` | Slack label, default `production` |
| `ORG_NAME` | Slack alert header text |
| `SLACK_WEBHOOK_URL` | Where alerts go |
| `CHECK_TOKEN` | Bearer token for `/check` |

In the GitHub Actions cron (`.github/workflows/health-check.yml`):

- Rename `secrets.REMEMBER_HEALTH_CHECK_TOKEN` to your secret name
- Set repo variable `REMEMBER_HEALTH_ALERT_URL` to your worker URL
  (default `https://remember-health-alert.workers.dev`)

## 4. Google Workspace (Sheets, Drive, Docs)

Create a service account in your GCP project, grant it **Domain-Wide Delegation**
scopes for your Workspace subject (typically an `it-admin@` alias):

| Env var | Purpose |
|---------|---------|
| `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL` | SA email |
| `GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY` | PEM private key (one line, `\n` for newlines) |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | The spreadsheet that holds your sheet tabs |
| `GOOGLE_WORKSPACE_IMPERSONATE_USER` | DWD subject (e.g. `it-admin@your-domain.example`) |
| `GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID` | Parent folder for applicant docs |
| `GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID` | Where auto-generated review Docs go |

Sheet tab contracts are documented in `CLAUDE.md` (Professional Applications
47 columns, Renewals 14 columns, Associate Applications 16 columns). Use those
exact column letters — the code reads positionally.

## 5. Stripe

| Env var | Purpose |
|---------|---------|
| `STRIPE_SECRET_KEY` | `sk_test_…` for staging, `sk_live_…` for prod |
| `STRIPE_WEBHOOK_SECRET` | Signing secret from `stripe listen` or Dashboard |
| `STRIPE_PRICE_PROFESSIONAL` | Price ID for the Pro tier |
| `STRIPE_PRICE_ASSOCIATE` | Price ID for the Associate tier |
| `STRIPE_PRICE_PROFESSIONAL_RENEWAL` | Pro renewal price |
| `STRIPE_PRICE_ASSOCIATE_RENEWAL` | Associate renewal price |

Webhook endpoints (configure in Stripe Dashboard):
- Staging: `https://your-app-staging.fly.dev/api/stripe-webhook`
- Production: `https://your-app.example/api/stripe-webhook`

## 6. Email

Two providers supported (pick one):

**Mailgun:**
- `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`
  (e.g. `Re:Member <no-reply@mg.your-domain.example>`)

**Gmail OAuth:**
- `GMAIL_SENDER_EMAIL`, `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`,
  `GMAIL_OAUTH_REFRESH_TOKEN`

## 7. Sample form content (the big one)

The blueprint ships with EOL-doula + NZ-specific sample data. Touch these before
real applicants.

### 7a. Schema-driven forms (edit JSON)

Phase A of the schema-driven form system is shipped — the runtime,
validators, tier config, and renderer skeleton live in
`src/lib/forms/`. As Phase B-D migrate each form, content moves from
hardcoded `.astro` markup into per-form JSON content files:

| Form | Schema TS | Content JSON |
|------|-----------|--------------|
| Associate renewal | `src/lib/forms/schemas/renewAssociate.ts` | `src/lib/forms/schemas/renewAssociate.content.json` |
| Professional renewal | `src/lib/forms/schemas/renewPro.ts` | `src/lib/forms/schemas/renewPro.content.json` |
| PD log entry | `src/lib/forms/schemas/pdLog.ts` | `src/lib/forms/schemas/pdLog.content.json` |
| Associate application | `src/lib/forms/schemas/associateApply.ts` | `src/lib/forms/schemas/associateApply.content.json` |
| Professional application | `src/lib/forms/schemas/professionalApply.ts` | `src/lib/forms/schemas/professionalApply.content.json` |

Once a schema exists for a form, non-developers edit labels, descriptions,
placeholders, help text, option **labels**, and ordering in the
`.content.json` file — no code review required. Phase E ships
`docs/forms/composing-a-form.md` with the full walkthrough.

### 7b. Schema-driven forms — things only engineers can edit

Even after a form migrates, the **types**, **validators**, **option
values**, **conditional `visibleWhen` predicates**, and **sheet column
letters** stay in the TypeScript schema (the compiler protects those
contracts). Plan review finding M3: a predicate like
`visibleWhen: (v) => v.listOnPage === "yes"` depends on the literal
`"yes"`, so option values must live in TS. The JSON is labels + ordering
only.

If you need to:
- Add a new field → edit the schema TS + content JSON + sheet column map
- Change a validator → edit the schema TS
- Change a `visibleWhen` predicate → edit the schema TS
- Reorder grid columns → edit the schema TS (column **labels** can move to JSON)

These edits require code review because they touch the production sheet
contract.

### 7c. Not-yet-migrated forms (Phase A only — edit `.astro` files)

Until Phase B-D land, the following files still contain hardcoded form
content. Edit them in place with the same care you would for any
production `.astro`:

- `src/pages/professional/apply.astro` — 8-step wizard, 21 core competencies
  (`COMPETENCIES` const around line 564), 8 declarations, 6 required doc types,
  3 example narratives
- `src/pages/apply.astro` — Associate application fields (`interestJoining`,
  `trainingDetails`, `listOnPage`/`listingDetails` conditional)
- `src/pages/renew/pro.astro` — Professional Development entries (10 hours/year
  commitment language)
- `src/pages/renew/associate.astro` — Associate renewal identity fields
- `src/pages/renew/pd-log.astro` — PD-log entry rows
- `src/lib/email-sender.ts` — email bodies reference "End of Life Doula",
  "Doula hubs", "Re:Member meetings", "Code of Ethics", "Scope of Practice"

`docs/superpowers/plans/currently-i-believe-the-kind-cloud.md` (the schema-abstraction
plan) is the source of truth for which form migrates when. Sections
Phase B (Associate renewal pilot), Phase C (Professional application),
Phase D (Pro renewal + PD log + Associate application), and Phase E
(docs + non-dev example) cover the full migration.

## 8. Pre-deploy checklist

- [ ] All env vars in section 1 set per environment
- [ ] Fly apps created, names updated in `fly.toml` + workflows
- [ ] Cloudflare Worker deployed with secrets set; `REMEMBER_HEALTH_ALERT_URL`
      repo var configured
- [ ] Google Workspace service account + DWD configured
- [ ] Sheets created with the documented column contracts
- [ ] Drive folders created (Applications parent, Review Docs optional)
- [ ] Stripe products + prices created, webhook endpoints registered
- [ ] Email provider configured, sending domain verified, SPF/DKIM/DMARC set
- [ ] Sample form content in section 7 reviewed + replaced
- [ ] `npm run test` green, `npm run check` reviewed for new type errors
- [ ] Smoke test full apply + renewal flow on staging with a test card
