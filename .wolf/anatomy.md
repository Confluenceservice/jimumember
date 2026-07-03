# anatomy.md

> Auto-maintained by OpenWolf. Phase A + B + F landed.
> Files: 8 new in src/lib/forms/ + dynamic [tier] renewal route replacing per-tier files + runtime required-safety-net.

## src/lib/forms/

- `types.ts` — FieldType, FieldDefinition, Step, FormSchema, FormContent. BaseField has `required?: boolean` + `requiredMessage?: string` (Phase F). (~225 lines, ~1600 tok)
- `validators.ts` — emailNZ (header-injection-safe), phoneNZ, ynRadio, minLength/maxLength, regex, required, conditional, runValidator internals, `isBlank` exported for runtime.ts (~150 lines, ~1100 tok)
- `runtime.ts` — loadSchema, validate (now enforces field.required as safety net), toRow (now honours visibleWhen), walkFields, mapApiResponseToValues, validateTier (~240 lines, ~1900 tok)
- `tiers.ts` — TierConfig, TIERS (advanced/basic; storageValue adv/basic, legacy pm/am mapped on read), getTier, listTiers, UnknownTierError (~85 lines, ~700 tok)
- `validators.test.ts` — 20 tests covering EMAIL_RE CR/LF injection, validators, conditional (~110 lines, ~900 tok)
- `runtime.test.ts` — 14 tests: walkFields, validate, toRow, serialize rules + 5 implicit-required safety-net cases (Phase F) (~225 lines, ~1500 tok)
- `tiers.test.ts` — 6 tests for TIERS frozen, getTier, listTiers, UnknownTierError (~50 lines, ~400 tok)

## src/lib/forms/render/

- `FieldRenderer.astro` — Schema-driven field renderer, all 7 FieldDefinition variants. Reads content from .content.json via field.contentKey. Server-side render only; recursion via InlineRenderer sibling. (~180 lines, ~1500 tok)
- `InlineRenderer.astro` — Internal recursive renderer for group/repeatable expansion (Astro doesn't allow component self-import). (~25 lines, ~150 tok)
- `Step.astro` — Step wrapper (title + fields + nav slot). (~30 lines, ~250 tok)
- `form-client.ts` — Client runtime: attachAutosaveQueue, attachRepeatable, attachVisibleWhen, attachUploadLock, hydrateFromResponse, mount, assertOptionValuesExist. Phase A skeleton; full impl in Phase C. (~260 lines, ~1900 tok)

## docs/

- `CUSTOMIZE.md` — Section 7 rewritten: 7a schema-driven (edit JSON), 7b engineers-only (TS schema), 7c not-yet-migrated (edit .astro). (~50 line delta)
- `forms/composing-a-form.md` — THE how-to for adding/editing a form (spec 012). Non-dev surface (content.json: labels/placeholders/help/option labels) vs engineer surface (TS: types/validators/columnMap/visibleWhen). Full 12-validator list. Copy-template = `example.memberSurvey.{ts,content.json}`, smoke page `/_dev/forms/example`. (~95 lines, ~800 tok)
- `forms/composing-a-tier.md` — adding a membership tier: TIERS entry (advanced/basic + new slug), storageValue rules (avoid adv/basic + legacy pm/am), Stripe products, schema pair, tests, what's automatic. (~65 lines, ~600 tok)
- `forms/migration-map.md` — column-letter map per sheet (Renewals 14 col, Advanced Applications 47, Basic Applications 16); managed-vs-schema cell split; legacy pm/am tier-value note. Ops triage doc. (~45 lines, ~500 tok)

## src/lib/forms/schemas/

- `renewBasic.ts` (renamed from renewAssociate, Phase K) — Basic renewal schema (4 fields: firstName, lastName, email, year). columnMap: C/D/E/F. rowFactory: appendRenewal. (~55 lines, ~400 tok)
- `renewBasic.content.json` — Editable labels/placeholders/autocompletes for the 4 identity fields. (~25 lines, ~150 tok)
- `renewBasic.test.ts` — 8 tests for validate/toRow/managed-cell exclusion. (~80 lines, ~550 tok)
- `renewAdvanced.{ts,content.json,test.ts}` — Advanced renewal schema (adds phone + pdEntries repeatable). Same pattern.
- `basicApply.{ts,content.json,test.ts}` / `advancedApply.{ts,content.json,test.ts}` — application schemas (16-col / 47-col). advancedApply derives COMPETENCY_IDS + FURTHER_REQUIREMENT_IDS from content.json option keys (Phase L).
- `example.memberSurvey.{ts,content.json,test.ts}` — non-production copy-me template exercising every field variant; smoke page /_dev/forms/example.
- `pdLog.ts` — PD log schema (Phase H: `entries` is repeatable with 4 itemFields; handler synthesises per-entry validation schema). columnMap: H. (~40 lines, ~300 tok)
- `pdLog.content.json` — Editable labels for entries + nested entries.dateCompleted/activity/totalHours/provider. (~15 lines, ~100 tok)
- `pdLog.test.ts` — 6 tests: id, structure, validate-empty, validate-array, minRows, columnMap. (~45 lines, ~350 tok)

## src/pages/advanced/ (renamed from professional/, Phase K)

- `apply.astro` — Pro application wizard (Phase J1: 1692→1295 lines). Sections 1-7 now Step + FieldRenderer; step 8 (uploads) stays inline for J3. saveFormData is stubbed for J2 (FormData rewrite). (~1295 lines, ~8500 tok)

- `[tier].astro` — Dynamic renewal page. Replaces associate.astro + pro.astro. Loads schema per tier (associate in Phase B, professional in Phase G). Schema serialised to JSON island, mounted by `form-client.ts` module script. (~165 lines, ~1300 tok)
- (DELETED Phase B) `associate.astro` — Replaced by [tier].astro
- (DELETED Phase G) `pro.astro` — Replaced by [tier].astro

## src/pages/api/renew/checkout/

- `[tier].ts` — Dynamic renewal checkout handler. tier → validateTier → appendRenewal → Stripe. Passes phone + pdEntries (Phase G). TIER_LOOKUP_KEY map for B2 (Phase D derives from TIERS). (~140 lines, ~1000 tok)
- `[tier].test.ts` — 11 tests: associate happy + 2 professional (full + empty PD) + tier param + unknown tier + dry-run + 3 error codes. (~190 lines, ~1400 tok)
- (DELETED Phase B) `checkout-am.ts` + `checkout-am.test.ts` — Replaced by [tier].ts
- (DELETED Phase G) `checkout-pm.ts` + `checkout-pm.test.ts` — Replaced by [tier].ts

## src/lib (notification routing)

- `notification-rules.ts` — Sheet-driven webhook notification routing (2026-06-30). `NotificationEvent` union (3 wired + 4 reserved) + `getRecipientsForEvent(event, fallback?)`: filters enabled sheet rules, falls back to env email on read-fail OR no-match. (~50 lines, ~450 tok)
- `notification-rules.test.ts` — 7 tests: enabled match, multiple recipients, case-sensitive TRUE, fallback-on-miss, fallback-on-throw, empty no-fallback ×2. Uses `vi.hoisted` for mocks. (~95 lines, ~700 tok)
- `google-sheets.ts` (MODIFIED 2026-06-30) — added `readNotificationRules()` (reads `'Notification Rules'!A2:C`, no cache) + self-contained `ensureNotificationRulesSheet()` (writes headers once at creation; NOT the shared `ensureSheetWithHeaders`, which reverts admin edits). Also: appendCheckoutLog/appendEmailLog/appendBasicApplication + JWT auth.
- `stripe-webhook.ts` (MODIFIED 2026-06-30) — 3 notification sites now resolve recipients via `getRecipientsForEvent` + fire-and-forget forEach instead of hardcoded ADMIN_EMAIL/SUPPORT_EMAIL.

## Feedback system (ported from eldaa PR #27, 2026-07-01)

- `src/lib/feedback-sheet.ts` — `appendFeedback`/`readFeedback`, self-contained sheets-client + retry (mirrors `renewal-sheet.ts`, not the shared-helpers pattern eldaa later grew — re-member never had that module). Lazy-creates "Feedback" tab, headers `timestamp|type|page|reaction|comment|answers`, self-heals header row. (~205 lines)
- `src/lib/feedback-sheet.test.ts` — 8 tests: append columns/order, JSON answers, tab creation, missing-config throw, read/parse/skip-header, empty sheet, malformed-JSON fallback.
- `src/pages/api/feedback.ts` — `POST` validates `type`/`page`/`rating`(1-3)/`comment`/`answers`, writes via `appendFeedback`, fires non-blocking `feedback_received` notification email (never blocks response).
- `src/pages/api/feedback.test.ts` — 10 tests: happy paths (inline + post_submission), all validation rejections, invalid JSON, sheet-write 500, fire-and-forget notify + notify-failure paths.
- `notification-rules.ts` (MODIFIED) — added `feedback_received` to `NotificationEvent` union.
- `src/components/FeedbackWidget.astro` — floating bottom-right button + reaction/comment panel, posts `type: "inline"`. Auto-captures `location.pathname+search` + `#step-label` text if present. Wired into `apply.astro`, `advanced/apply.astro`, `renew/[tier].astro`, `renew/pd-log.astro`.
- `src/components/PostSubmissionFeedback.astro` — 3-question + free-text block, posts `type: "post_submission"`. Wired into `advanced/success-upload.astro` (`page="advanced_success_upload"`) and `associate-membership.astro` (`page="associate_membership"`). `renew/success.astro` deliberately skipped (matches eldaa — only the 2 real success pages get it).
## Testing harness (bug-006 regression net)

- `playwright.config.ts` (root) — E2E config. node-standalone build+preview on :4321 via `webServer`; injects `E2E_STUB=1` so Sheets/Mailgun are stubbed server-side. chromium only. (~45 lines, ~500 tok)
- `e2e/apply.spec.ts` — 4 Playwright smokes: Flow A (Start Application reaches real route, verify panel renders — bug-004), Flow B (forcefail@ recipient → emailError diagnostic renders — bug-005), + /apply & /renew/basic load/no-404. (~110 lines, ~900 tok)
- `src/lib/__guards__/stale-paths.test.ts` — 2 unit guards: no `/professional/` route literal in `src/**`, and every `/api/` path the apply pages fetch maps to a real route file. Excludes itself. (~110 lines, ~900 tok)
- `.github/workflows/test.yml` — CI gate (PR + push to main): `unit` job (check + vitest) + `e2e` job (playwright install + test:e2e). The fly-deploy*.yml workflows run no tests. (~55 lines, ~400 tok)
- E2E shims live in `src/lib/upload-sheet.ts` (`makeStubSheetsClient` in `getSheetsClient`) + `src/lib/email-sender.ts` (`E2E_FORCE_EMAIL_FAIL` / `E2E_STUB` + forcefail-recipient guard at top of `sendEmail`).
- (DELETED 2026-06-29, bug-006) `src/pages/professional.astro` + `src/pages/api/create-professional-checkout.ts` — dead legacy alias + its endpoint; meta-refresh pointed at a non-existent `/professional/apply/`.
- (DELETED Phase G) `checkout-pm.ts` + `checkout-pm.test.ts` — Replaced by [tier].ts
## Membership durability + auto-renewal (2026-07-03, branches fix/memberships-durability + fix/auto-renewal-recording)

- `src/lib/memberships.ts` — durable subscription-state mirror in the `Memberships` sheet tab (9 cols A-I, spec 000 REQ-OV-003). Upsert setters, per-customer promise-chain serialisation, last_event provenance. Built on google-sheets-helpers. All exports async. (~240 lines, ~1900 tok)
- `src/lib/memberships.test.ts` — 15 tests against the real module with mocked helpers: upsert-on-missing regression, round-trip, hasActiveSubscription truth table, write serialisation + failed-op queue recovery. (~250 lines, ~1900 tok)
- `bin/memberships-backfill.js` — rebuilds the Memberships tab from Stripe (option_c subs). Self-contained plain JS (no src/ imports), idempotent upserts, --dry-run/--limit, 2.5s throttle. (~160 lines, ~1300 tok)
- `src/pages/api/stripe-webhook.ts` — handleInvoicePaid now records auto-renewals (invoice.payment_succeeded, subscription_cycle only): dedupe via stripe_session, paid Renewals row, admin email, adv PD link, setActive. Membership calls awaited with provenance ids. (~700 lines, ~5400 tok)
- `src/lib/renewal-sheet.ts` — adds getRenewalByStripeRef (col L lookup, auto-renewal idempotency), RenewalInput.paymentStatus widened to pending|paid + optional paidAt, shared rowToRenewal mapper. (~200 lines, ~1500 tok)

## OSS hygiene pack (2026-07-03)

- `.github/dependabot.yml` — weekly npm (grouped minor+patch, majors solo) + monthly actions bumps. (~25 lines)
- `.github/workflows/codeql.yml` — CodeQL js/ts scan on PR + push + weekly cron. (~30 lines)
- `.github/workflows/release.yml` — tag `v*` → npm check+test verify job → GitHub Release with generated notes. The release gate fly-deploy lacks. (~40 lines)
- `.github/ISSUE_TEMPLATE/` — bug_report.yml (flow dropdown, env mode, no-secrets checkbox), feature_request.yml, config.yml (private-security-report link; YOUR-ORG placeholder). (~120 lines total)
- `.github/pull_request_template.md` — summary/REQ-IDs/verification checklist incl. live-proof line. (~25 lines)
- `SECURITY.md` — private vulnerability reporting policy, scope notes (Stripe-hosted cards, per-fork creds). (~25 lines)
- `CONTRIBUTING.md` — dev setup, 3-step test ladder, gotcha conventions (REQ-IDs, content-vs-schema, shared CSS, route-rename sweep). (~50 lines)
- `.claude/skills/maintainer/SKILL.md` — single-repo maintenance skill: authorization boundaries, triage classes, decision-ready rule, verification ladder + live-proof gate, release gate, maintainer log. (~110 lines)
- `docs/DEPLOY.md` §16 — enabling the already-wired dormant Sentry (SENTRY_DSN via fly secrets, OSS plan link).
