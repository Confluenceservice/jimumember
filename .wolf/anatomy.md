# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-06-24T20:30:43.205Z
> Files: 137 tracked | Anatomy hits: 0 | Misses: 0

## ./

- `.dockerignore` — Docker ignore rules (~37 tok)
- `.DS_Store` (~3276 tok)
- `.gitignore` — Git ignore rules (~147 tok)
- `.mcp.json` (~25 tok)
- `astro.config.mjs` — Astro configuration (~85 tok)
- `CLAUDE.md` — OpenWolf (~2593 tok)
- `Confirm applicant email before continuing professional application.md` — Problem (~880 tok)
- `Dockerfile` — Docker container definition (~119 tok)
- `fly.toml` — fly.toml app configuration file generated for eldaa on 2026-03-23T18:33:46+13:00 (~184 tok)
- `package-lock.json` — npm lock file (~94070 tok)
- `package.json` — Node.js package manifest (~403 tok)
- `README.md` — Project documentation (~482 tok)
- `skills-lock.json` (~175 tok)
- `subscribe.eldaa.org.nz.har` (~121298 tok)
- `tsconfig.json` — TypeScript configuration (~27 tok)
- `vitest.config.ts` — Vitest test configuration (~69 tok)

## .agents/skills/stripe-best-practices/

- `SKILL.md` — Integration routing (~848 tok)

## .agents/skills/stripe-best-practices/references/

- `billing.md` — Billing / Subscriptions (~534 tok)
- `connect.md` — Connect / platforms (~779 tok)
- `payments.md` — Payments (~1652 tok)
- `security.md` — Security best practices (~1978 tok)
- `treasury.md` — Treasury / Financial Accounts (~198 tok)

## .agents/skills/stripe-projects/

- `SKILL.md` — Stripe Projects — Service Provisioning (~1287 tok)

## .agents/skills/upgrade-stripe/

- `SKILL.md` — Upgrading Stripe Versions (~1402 tok)

## .astro/

- `content.d.ts` — Resolve an array of entry references from the same collection (~1518 tok)
- `settings.json` (~17 tok)
- `types.d.ts` — / <reference types="astro/client" /> (~22 tok)

## .claude/

- `.DS_Store` (~1640 tok)
- `settings.json` (~441 tok)
- `settings.local.json` (~676 tok)

## .claude/rules/

- `openwolf.md` (~313 tok)

## .data/

- `applicants.json` (~1875 tok)
- `memberships.json` (~75 tok)

## .github/workflows/

- `fly-deploy-staging.yml` — CI: Fly Deploy Staging (~111 tok)
- `fly-deploy.yml` — See https://fly.io/docs/app-guides/continuous-deployment-with-github-actions/ (~198 tok)
- `health-check.yml` — CI: Health check (~399 tok)

## .gstack/

- `.DS_Store` (~1640 tok)
- `browse-audit.jsonl` — Declares fillField (~9398 tok)
- `browse-console.log` (~137 tok)
- `browse-network.log` (~10187 tok)
- `claude-available.json` (~52 tok)

## .gstack/qa-reports/

- `baseline.json` (~144 tok)
- `qa-report-eldaa-fly-dev-2026-04-19.md` — QA Report — eldaa.fly.dev/professional/apply (~903 tok)
- `qa-report-eldaa-fly-dev-2026-04-27.md` — QA Report — eldaa.fly.dev — 2026-04-27 (~462 tok)
- `qa-report-eldaa-fly-dev-2026-05-14.md` — QA Report — eldaa.fly.dev (Staging) (~798 tok)
- `qa-report-eldaa-fly-dev-2026-06-23.md` — QA Report — eldaa.fly.dev — 2026-06-23 (~1148 tok)
- `qa-report-localhost-2026-03-22.md` — QA Report — eldaa (localhost:4321) (~578 tok)
- `qa-report-localhost-2026-06-09.md` — QA Report: eldaa — /renew/* checkout pages (~1357 tok)

## .run/

- `dev.log` (~972 tok)
- `dev.pid` (~2 tok)
- `find-spreadsheets.mjs` — One-off: find spreadsheets and remaining ELDAA items. (~646 tok)
- `inspect-applicant-completeness.mjs` — Diagnose why applicant b68936c3-2acf-45c4-b103-24108d1d23f7 is reported as incomplete. (~1312 tok)
- `inspect-checkout.mjs` — Look up a Stripe session in the checkout log to find the matching applicant. (~986 tok)
- `list-parent-children.mjs` — One-off: list children of the new shared-drive parent and the lowercase (~574 tok)
- `probe-drive-ids.mjs` — One-off: probe Drive as service account (no DWD impersonation). (~1777 tok)
- `probe-dwd-impersonation.mjs` — One-off: verify DWD impersonation under it-admin@eldaa.org.nz (~808 tok)
- `probe-find-pm-folder.mjs` — One-off: locate the actual parent of PM Applications folder. (~876 tok)
- `probe-folder-meta.mjs` — One-off: probe metadata on candidate folders to see parents + driveId (~1103 tok)
- `probe-perms.mjs` — Declares SA_EMAIL (~318 tok)
- `probe-review.mjs` — Declares SA_EMAIL (~191 tok)
- `smoke-upload-staging.mjs` — Smoke test: read the staging sheet, find a recent applicant, use their (~792 tok)
- `stripe-listen.log` (~5408 tok)
- `stripe-listen.pid` (~2 tok)

## .run/health-alert-worker/

- `worker.mjs` — eldaa-health-alert (module worker) (~1554 tok)
- `wrangler.toml` (~53 tok)

## docs/

- `.DS_Store` (~1640 tok)
- `bug-scan-report.md` — Astro App Bug Scan (~1799 tok)
- `membership-applications-overview.md` — ELDAA Membership Applications — User Overview (~3797 tok)
- `notifications.md` — ELDAA Notifications (~2034 tok)

## docs/runbooks/

- `google-workspace-domain-wide-delegation.md` — Google Workspace Domain-Wide Delegation for ELDAA Drive Uploads (~1126 tok)
- `mailgun-setup.md` — Mailgun setup for ELDAA transactional email (~1576 tok)

## docs/superpowers/plans/

- `2026-06-23-membership-renewal-form.md` — Membership Renewal Form Implementation Plan (~20817 tok)

## professional_form/

- `ELDAA_PM_Application.md` — | **Ethnicity:** | (~1927 tok)
- `FORM_PLAN.md` — Professional Membership Application — Digital Form (~2602 tok)

## src/

- `.DS_Store` (~1639 tok)
- `env.d.ts` — / <reference types="astro/client" /> (~142 tok)
- `env.ts` (~7 tok)
- `middleware.ts` — In-memory rate limiter for API routes. (~939 tok)

## src/layouts/

- `BaseLayout.astro` — Astro: BaseLayout, 1 slot(s) (~175 tok)

## src/lib/

- `drive-files.ts` — Exports DriveFileRecord, addDriveFile, softDeleteDriveFile, listDriveFiles + 2 more (~1414 tok)
- `email-sender.test.ts` — Hoisted mocks — must come before the module under test imports them. (~2846 tok)
- `email-sender.ts` — Exports EmailTemplate, sendEmail, sendProfessionalConfirmation, sendAssociateConfirmation + 4 more (~2503 tok)
- `google-auth.ts` — Service-account impersonation. When set, the service account JWT carries a (~1075 tok)
- `google-docs.ts` — Exports createAssociateApplicationReviewDoc (~6274 tok)
- `google-sheets.test.ts` — Mock googleapis before importing the module under test (~3375 tok)
- `google-sheets.ts` — Exports appendCheckoutLog, appendEmailLog, appendAssociateApplication (~1410 tok)
- `logger.ts` — Global base logger — always JSON, always structured (~311 tok)
- `memberships.test.ts` — Test the logic in isolation by re-implementing the store operations locally (~2001 tok)
- `memberships.ts` — Exports MembershipStatus, MembershipRecord, getMembership, setAwaitingSubscription + 4 more (~639 tok)
- `renewal-sheet.test.ts` — call: makeTransientError (~3603 tok)
- `renewal-sheet.ts` — Exports PdEntry, RenewalInput, RenewalRow, _resetSheetsClientCacheForTesting + 4 more (~3159 tok)
- `staging.ts` — Returns the staging folder-name prefix for the current environment. (~206 tok)
- `stripe-checkout.test.ts` — NZ: dt (~1414 tok)
- `stripe-checkout.ts` — Calculate first-term amount using proration from now until next July 1. (~828 tok)
- `stripe-products.test.ts` — Declares mockPricesRetrieve (~1208 tok)
- `stripe-products.ts` — Exports LookupKey, resolveRenewalPrice, invalidateRenewalPriceCache (~693 tok)
- `upload-sheet.test.ts` — Mocks - use inline factories so vi.fn() references are valid (not hoisted) (~7086 tok)
- `upload-sheet.ts` — Exports REQUIRED_DOC_TYPES, OPTIONAL_DOC_TYPES, DocType, UploadStatus + 4 more (~7879 tok)

## src/pages/

- `apply.astro` — Astro: apply (~3111 tok)
- `associate-membership.astro` — Astro: associate-membership (~362 tok)
- `cancel.astro` — Astro: cancel (~136 tok)
- `index.astro` — Astro: index (~1722 tok)
- `professional.astro` — Astro: professional (~1760 tok)
- `success.astro` — Astro: success (~872 tok)

## src/pages/api/

- `create-checkout-session.ts` — Option C: mode=payment (one-time charge) (~2794 tok)
- `create-professional-checkout.ts` — Exports POST (~1800 tok)
- `debug-env.ts` — Exports GET (~172 tok)
- `get-prices.ts` — Exports GET (~417 tok)
- `health.test.ts` — Mock Stripe — control products.list behaviour per test. (~2417 tok)
- `health.ts` — Exports GET (~1331 tok)
- `session-info.ts` — API routes: GET (1 endpoints) (~342 tok)
- `stripe-webhook.test.ts` — --------------------------------------------------------------------------- (~5943 tok)
- `stripe-webhook.ts` — Option C (mode=payment): (~5253 tok)

## src/pages/api/professional/

- `apply.test.ts` — BASE_URL: makeRequest (~3638 tok)
- `apply.ts` — API routes: GET (1 endpoints) (~4363 tok)
- `delete-file.ts` — Exports POST (~577 tok)
- `resend-link.test.ts` — Declares makeRequest (~1426 tok)
- `resend-link.ts` — Resends the resume-link email to the applicant identified by resume token. (~849 tok)
- `upload-complete.ts` — Exports POST (~1830 tok)
- `upload-file.test.ts` — makeMultipartRequest: makeBinaryRequest, seedSuccessfulDriveCalls, seedFolderCreationCalls (~2221 tok)
- `upload-file.ts` — API routes: GET (9 endpoints) (~5466 tok)

## src/pages/api/renew/

- `checkout-am.test.ts` — VALID_BODY: call (~1444 tok)
- `checkout-am.ts` — Exports POST (~1326 tok)
- `checkout-pm.test.ts` — VALID_BODY: call (~2158 tok)
- `checkout-pm.ts` — Exports POST (~1603 tok)
- `pd-log.ts` — GET returns member name + pdEntries (403 if not paid, 404 if missing); POST overwrites pd_entries by renewal_id (~700 tok)
- `session-info.test.ts` — mockStripeSessionsRetrieve: call (~539 tok)
- `session-info.ts` — API routes: GET (1 endpoints) (~414 tok)

## src/pages/professional/

- `apply.astro` — Astro: apply (~20726 tok)
- `cancel-upload.astro` — Astro: cancel-upload (~255 tok)
- `cancel.astro` — Astro: cancel (~146 tok)
- `success-upload.astro` — Astro: success-upload (~304 tok)

## src/pages/renew/

- `associate.astro` — Astro: associate (~1643 tok)
- `pd-log.astro` — Astro: pd-log (~2682 tok)
- `pro.astro` — Astro: pro (~3308 tok)
- `success.astro` — Astro: success (~360 tok)

## src/styles/

- `global.css` — Styles: 4 rules, 10 vars, 1 layers (~191 tok)
