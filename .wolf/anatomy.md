# anatomy.md

> Auto-maintained by OpenWolf. Phase A + B landed.
> Files: 8 new in src/lib/forms/ + dynamic [tier] renewal route replacing per-tier files.

## src/lib/forms/

- `types.ts` — FieldType, FieldDefinition, Step, FormSchema, FormContent (~210 lines, ~1500 tok)
- `validators.ts` — emailNZ (header-injection-safe), phoneNZ, ynRadio, minLength/maxLength, regex, required, conditional, runValidator internals (~150 lines, ~1100 tok)
- `runtime.ts` — loadSchema, validate, toRow, walkFields, mapApiResponseToValues, validateTier (~220 lines, ~1700 tok)
- `tiers.ts` — TierConfig, TIERS (professional/associate), getTier, listTiers, UnknownTierError (~85 lines, ~700 tok)
- `validators.test.ts` — 20 tests covering EMAIL_RE CR/LF injection, validators, conditional (~110 lines, ~900 tok)
- `runtime.test.ts` — 9 tests for walkFields, validate, toRow, serialize rules (~165 lines, ~1100 tok)
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

## src/pages/renew/

- `[tier].astro` — Dynamic renewal page. Replaces associate.astro + pro.astro. Loads schema per tier (associate wired in Phase B; professional in Phase D). (~140 lines, ~1100 tok)
- (DELETED Phase B) `associate.astro` — Replaced by [tier].astro

## src/pages/api/renew/checkout/

- `[tier].ts` — Dynamic renewal checkout handler. tier → validateTier → appendRenewal → Stripe. TIER_LOOKUP_KEY map for B2 (Phase D derives from TIERS). (~110 lines, ~800 tok)
- `[tier].test.ts` — 9 tests covering happy path + metadata.tier="am" assertion (plan C3) + tier param + unknown tier + dry-run + error codes. (~120 lines, ~900 tok)
- (DELETED Phase B) `checkout-am.ts` + `checkout-am.test.ts` — Replaced by [tier].ts