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