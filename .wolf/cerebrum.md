# cerebrum.md

> Phase A schema-driven form system, 2026-06-26.

## Decision Log

- **2026-06-26** — Schema abstraction plan executed as Phase A only. 5 phases total (A foundation, B Associate renewal pilot, C Professional apply, D Pro+PD+Associate apply, E docs). Phase A shipped runtime + validators + tier config + renderer skeleton. Phases B-D ship in subsequent sessions; each is its own migration.
- **2026-06-26** — EMAIL_RE unified to `/^[^\r\n@\s]+@[^\r\n@\s]+\.[^\r\n@\s]+$/` (header-injection-safe) across all three previously-duplicated copies (`apply.ts:35`, `checkout-pm.ts:7`, `checkout-am.ts:7`). Closes latent CR/LF bug in `apply.ts:35` which used `[^\s@]` and would accept `\r\nBcc:` payloads.
- **2026-06-26** — Option **values** stay in TypeScript schema (not JSON content). Reason: `visibleWhen: (v) => v.listOnPage === "yes"` predicates depend on literal option values; if those lived in JSON, a non-dev relabeling `"yes"` → `"Yes"` would silently break both client show/hide AND server validation. JSON carries option **labels** + ordering only. See `assertOptionValuesExist` in `form-client.ts` for the safety net.

## Key Learnings

- **Astro component self-import is not supported.** Recursive components need a sibling helper file (e.g. `InlineRenderer.astro` that wraps `FieldRenderer.astro`) — Astro refuses `import FieldRenderer from "./FieldRenderer.astro"` inside the same file when it would loop.
- **Schema-validation test for option-value references** is load-bearing: any future change that moves option values into JSON will fail `assertOptionValuesExist` at first call. Plan review finding M3.
- **Astro server route `src/pages/api/renew/checkout/[tier].ts`** uses SSR mode (`output: "server"` + `@astrojs/node` standalone). No `getStaticPaths` needed — params resolve at request time. Adding one would force prerender and break the route.
- **`getRenewalById` reader** (`renewal-sheet.ts:331`) hardcodes `match[1] === "am" ? "am" : "pm"` — defaults any unknown tier to `"pm"`. Phase A config-only path cannot add a third tier cleanly until this reader is made data-driven (Phase D).

## Do-Not-Repeat

- **(2026-06-26)** When defining a `repeatable` FieldDefinition in tests/schemas, ALWAYS include `itemFields`. The TypeScript type requires it; missing it surfaces as `ts(2322)` in astro check.
- **(2026-06-26)** Don't put backticks inside template literals — esbuild transform fails with `Expected ")" but found "schema"`. Use plain words or escape: ``${id} — no schema export in ${tsPath}`` not ``${id} — no `schema` export``.
- **(2026-06-26)** `ynRadio` validator semantics: blank is invalid (not optional). The presence of "yes" or "no" is required by definition; if blank should be allowed, add `required: false` on the field and let the `required` validator decide. Earlier draft had blank-skipped logic which was wrong.

## User Preferences

(none recorded yet)