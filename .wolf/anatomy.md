# anatomy.md

> Auto-maintained by OpenWolf. Phase A + B + F landed.
> Files: 8 new in src/lib/forms/ + dynamic [tier] renewal route replacing per-tier files + runtime required-safety-net.

## src/lib/forms/

- `types.ts` — FieldType, FieldDefinition, Step, FormSchema, FormContent. BaseField has `required?: boolean` + `requiredMessage?: string` (Phase F). (~225 lines, ~1600 tok)
- `validators.ts` — emailNZ (header-injection-safe), phoneNZ, ynRadio, minLength/maxLength, regex, required, conditional, runValidator internals, `isBlank` exported for runtime.ts (~150 lines, ~1100 tok)
- `runtime.ts` — loadSchema, validate (now enforces field.required as safety net), toRow (now honours visibleWhen), walkFields, mapApiResponseToValues, validateTier (~240 lines, ~1900 tok)
- `tiers.ts` — TierConfig, TIERS (professional/associate), getTier, listTiers, UnknownTierError (~85 lines, ~700 tok)
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

## src/lib/forms/schemas/

- `renewAssociate.ts` — Associate renewal schema (4 fields: firstName, lastName, email, year). columnMap: C/D/E/F. rowFactory: appendRenewal. (~55 lines, ~400 tok)
- `renewAssociate.content.json` — Editable labels/placeholders/autocompletes for the 4 identity fields. (~25 lines, ~150 tok)
- `renewAssociate.test.ts` — 8 tests for validate/toRow/managed-cell exclusion. (~80 lines, ~550 tok)
- `pdLog.ts` — PD log schema (Phase H: `entries` is repeatable with 4 itemFields; handler synthesises per-entry validation schema). columnMap: H. (~40 lines, ~300 tok)
- `pdLog.content.json` — Editable labels for entries + nested entries.dateCompleted/activity/totalHours/provider. (~15 lines, ~100 tok)
- `pdLog.test.ts` — 6 tests: id, structure, validate-empty, validate-array, minRows, columnMap. (~45 lines, ~350 tok)

## src/pages/professional/

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
