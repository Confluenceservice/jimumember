# Customizing JimuMember before deploy

JimuMember ships as a working blueprint with sample form content from a single
professional-membership organisation. Before you point it at real applicants,
walk this list.

## 1. Org identity (env vars)

Set these in `.env` (local) and as Fly secrets in production:

| Var | Purpose | Default in `.env.example` |
|-----|---------|---------------------------|
| `ORG_NAME` | Display name shown in email subjects + bodies | `JimuMember` |
| `SUPPORT_EMAIL` | Reply-To for transactional emails; **fallback** recipient for `advanced_payment_received` (see §6a) | `membership@example.com` |
| `ADMIN_EMAIL` | **Fallback** recipient for application + renewal notifications when no sheet rule matches (see §6a) | `admin@example.com` |
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
| `STRIPE_PRICE_1` | Price ID for tier index 1 (basic) — see `src/lib/forms/tiers.ts` for the N → tier mapping |
| `STRIPE_PRICE_2` | Price ID for tier index 2 (advanced) |
| `STRIPE_PRICE_1_RENEWAL` | Renewal price for tier index 1 (basic) |
| `STRIPE_PRICE_2_RENEWAL` | Renewal price for tier index 2 (advanced) |

Webhook endpoints (configure in Stripe Dashboard):
- Staging: `https://your-app-staging.fly.dev/api/stripe-webhook`
- Production: `https://your-app.example/api/stripe-webhook`

## 6. Email

Mailgun is the sole transactional-email provider (all three vars required):

- `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`
  (e.g. `JimuMember <no-reply@mg.your-domain.example>`)

`/api/health` reports `email: not_configured` (and the whole check goes
`degraded`) until these are set. See `docs/runbooks/mailgun-setup.md`.

> The earlier Gmail OAuth path was removed — Workspace session-control policy
> reauthed the refresh token every ~24h (`invalid_rapt`), recurrently degrading
> health. `GMAIL_*` env vars are no longer read by any code.

## 6a. Notification routing (no-deploy, sheet-driven)

Who receives the internal payment/renewal notifications is controlled from a
**"Notification Rules"** tab in the same Google Sheet (`GOOGLE_SHEETS_SPREADSHEET_ID`),
not from code. A volunteer admin edits rows and the change takes effect on the
**next webhook — no redeploy**. The tab auto-creates (empty, with headers) the
first time a webhook fires.

Columns:

| Col | Header | Meaning |
|-----|--------|---------|
| A | `event` | Event key — exact, **case-sensitive** match (see list below) |
| B | `recipient_email` | Address to notify for this rule |
| C | `enabled` | The literal `TRUE` enables the row. Anything else — `true`, `FALSE`, blank — disables it. |
| D | `description` | Free-text note; ignored by code |

Wired event keys:

| `event` value | Fires when | Falls back to |
|---------------|-----------|---------------|
| `advanced_payment_received` | A professional application is paid | `SUPPORT_EMAIL` |
| `basic_payment_received` | An associate application is paid | `ADMIN_EMAIL` |
| `advanced_renewal_received` | Any renewal is paid | `ADMIN_EMAIL` |
| `feedback_received` | A visitor submits site feedback | *(none — see note)* |

> **`feedback_received` has no fallback.** Unlike the payment events, the feedback
> caller passes no env-var safety net: if the sheet read fails or no enabled row
> matches, **no feedback email is sent** (the submission is still saved). Add at
> least one enabled `feedback_received` row if you want feedback notifications.

Rules:

- **Multiple recipients:** add several enabled rows with the same `event` — all are notified.
- **Safety net (fallback):** if the sheet read fails *or* no enabled row matches an
  event, the notification is sent to the env-var address in the table above, so
  notifications never silently vanish. To suppress an event entirely you must
  point its rule at a real inbox (e.g. an archive address) — leaving it
  disabled falls back to the env var, it does not mute it.
- **Header row is protected:** the app writes the header once at tab creation and
  never again, so editing/reordering admin rows is safe. (Don't rename the
  header cells, though — column order A–D is the contract.)

Reserved-but-unwired event keys (`basic_application_submitted`,
`advanced_application_submitted`, `document_uploaded`, `resume_link_sent`) are
declared in `src/lib/notification-rules.ts` for future use; rows for them are
read but nothing sends on them yet.

**Initial seed:** seed one enabled row per wired event pointing at your real
addresses so behaviour matches the env-var defaults from day one. Until seeded,
the fallback covers you.

## 6b. Localisation constants (currency, timezone, membership year)

These localisation values are centralised in `src/lib/config.ts` — change them
there (not scattered across modules):

| Constant | Default | Meaning |
|----------|---------|---------|
| `CURRENCY` | `"usd"` | Stripe currency code (lower-case). Stripe Prices must be created in this currency, or the guard in `stripe-products.ts` rejects them and health goes `degraded`. |
| `CURRENCY_SYMBOL` | `"$"` | Prefix for formatted amounts via `formatMoney()`. |
| `TIMEZONE` | `"UTC"` | IANA zone for the membership-year anchor + proration math. |
| `RENEWAL_ANCHOR_MONTH` / `RENEWAL_ANCHOR_DAY` | `7` / `1` | Membership year anchor (1 July). Renewals and the deferred subscription `trial_end` align to the next occurrence. **Env-overridable** — see below. |

The renewal anchor is the one localisation value exposed as an **environment
variable** (the rest are code constants), since the annual cutoff most often
differs per org. Set `RENEWAL_ANCHOR_MONTH` (1–12) and `RENEWAL_ANCHOR_DAY`
(1–31, valid for the month) in the env / Fly secrets. Unset or invalid values
fall back to 1 July, so existing deployments are unaffected. The values are
read server-side only (no `PUBLIC_` prefix).

Note: static fallback price strings (e.g. `$75.00` / `$150.00`) also appear as
display-only text in `src/pages/index.astro` and `src/pages/advanced/apply.astro`
and in the `submitLabel` of the renewal form `*.content.json` schemas — update
those by hand if you change amounts.

Changing the anchor env vars is now **fully self-contained** — no copy edits
needed. The pro-rata calculation and subscription `trial_end` honour the anchor
(via `getNextRenewalAnchorDate` in `src/lib/stripe-checkout.ts`), and all
user-facing date copy renders the anchor dynamically through
`formatAnchorDate()`: the landing pages (`index.astro` / `advanced/apply.astro`)
and the `renewalMessage` in `create-checkout-session.ts`,
`create-professional-checkout.ts`, and `api/advanced/upload-complete.ts`.

The only July-flavoured names left are the `next_july1_epoch` Stripe-metadata
key (a wire contract between the checkout endpoints and the webhook — renaming
it would orphan in-flight sessions across a deploy) and the `nextJuly1Epoch`
field on the membership record. Both are functionally anchor-agnostic; leave
them.

## 7. Sample form content (the big one)

The blueprint ships with generic sample data modeled on a real professional-
membership org (see `docs/DEPLOY.md` for a real fork example). Touch these
before real applicants.

### 7a. Schema-driven forms (edit JSON)

The schema-driven form system is shipped — the runtime, validators, tier
config, and renderer live in `src/lib/forms/`. Every current form has a
schema/content pair; non-developers edit labels, descriptions, placeholders,
help text, option **labels**, and ordering in the `.content.json` file — no
code review required. See `docs/forms/composing-a-form.md` for the full
walkthrough.

| Form | Schema TS | Content JSON |
|------|-----------|--------------|
| Associate renewal | `src/lib/forms/schemas/renewBasic.ts` | `src/lib/forms/schemas/renewBasic.content.json` |
| Professional renewal | `src/lib/forms/schemas/renewAdvanced.ts` | `src/lib/forms/schemas/renewAdvanced.content.json` |
| PD log entry | `src/lib/forms/schemas/pdLog.ts` | `src/lib/forms/schemas/pdLog.content.json` |
| Associate application | `src/lib/forms/schemas/basicApply.ts` | `src/lib/forms/schemas/basicApply.content.json` |
| Professional application | `src/lib/forms/schemas/advancedApply.ts` | `src/lib/forms/schemas/advancedApply.content.json` |

(`src/lib/forms/schemas/example.memberSurvey.{ts,content.json}` is the
copy-template for building a *new* form, not one of the shipped forms above.)

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

### 7c. One remaining hardcoded piece — edit the `.astro` file directly

All five forms above are schema-driven. The one exception is
`src/pages/advanced/apply.astro`'s `COMPETENCIES` and `DOC_DESCRIPTIONS`
consts (21 core competency labels/descriptions, and the doc-type help text
shown next to each upload) — these render alongside the schema-driven parts
of the same page but aren't sourced from `advancedApply.content.json`. Edit
them in place with the same care you would for any production `.astro`.

## 8. What it costs to run (TCO)

JimuMember has no license fee — the total cost of ownership is infrastructure
plus payment processing plus volunteer/developer time. Figures below are USD,
verified July 2026. Re-check quarterly; vendor pricing moves.

### Monthly infrastructure

| Component | Typical cost | Scales with |
|-----------|-------------|-------------|
| Fly.io (Astro SSR app) | $5–15/mo | Traffic, not contacts |
| Mailgun | $0–15/mo | Email volume (free tier ~100/day; Basic $15/mo = 10k emails) |
| Google Workspace (Sheets/Drive/Docs) | Usually $0 marginal | Nothing — SA rides your existing Workspace; nonprofits often get Workspace free |
| Cloudflare Worker (health cron) | $0 | Free tier |
| Stripe | 2.9% + $0.30 per transaction (US rate; varies by region) | Payment volume — nonprofit discount sometimes available |

Structural point: cost scales with **traffic and email volume, not database
size**. A 5,000-contact list costs the same to run as a 200-contact one.

### Worked comparison: 500 contacts, 300 members × $100/yr dues

Annual totals, ~$30,000 payment volume, annual-billing SaaS prices:

| Platform | Subscription/yr | Platform fees | Processing | Total/yr |
|----------|----------------|---------------|------------|----------|
| **JimuMember** | $120–360 (infra) | $0 | ~$960 | **~$1,080–1,320** |
| MemberPlanet Essentials | $600 | $600 (2% of payments) | ~$990 | ~$2,190 |
| WildApricot (500-contact tier) | $1,663 | $0¹ | ~$960 | ~$2,623 |
| Memberful Standard | $588 | $1,470 (4.9% of payments) | ~$960 | ~$3,018 |

¹ Assumes their in-house Personify Payments. Choosing Stripe instead triggers
WildApricot's 20% subscription surcharge (~$333/yr on this tier).

### The honest caveat

The table excludes labor. SaaS platforms bundle onboarding, hosting, and
support; JimuMember assumes someone technical deploys and maintains it (this
doc is that person's job description). If your org pays a developer even a few
hours a month at market rates, the gap narrows or inverts. JimuMember fits orgs
with a technical volunteer and a contact list big enough to feel SaaS
per-contact pricing — roughly the 250–5,000 contact range, where WildApricot
runs $82–485/mo.

## 9. Pre-deploy checklist

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
