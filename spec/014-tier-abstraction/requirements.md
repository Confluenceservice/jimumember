# Requirements — Tier Abstraction

> Spec ID: `014` · Type: cross-cutting · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`
> Referenced by: every form + renewal spec (`001`, `002`, `005`, `006`), plus `007`, `008`, `012`, `015`

## Overview

Re:Member supports an unbounded number of membership tiers via a frozen configuration object. Today: `basic`, `advanced`. Each tier has a stable storage value (decoupled from its public label) so renames don't break Sheet data.

## Functional Requirements

- **REQ-TA-001** `TIERS` frozen object in `src/lib/forms/tiers.ts` declares the canonical tier set. Adding a tier = adding an entry; no other code changes required.
- **REQ-TA-002** Each tier declares: `slug` (URL-safe key), `label` (public-facing name), `storageValue` (Sheet value, frozen for historical data), `tierLabelFor()` helper for display.
- **REQ-TA-003** `MembershipPlan = keyof typeof TIERS` — adding to TIERS extends the type automatically across the codebase.
- **REQ-TA-004** `getTier(slug)` returns the tier config or throws `UnknownTierError`. No silent defaults (bug-003: previous `getRenewalById` defaulted unknown tiers to advanced).
- **REQ-TA-005** Storage values are **immutable** post-launch. Tier rename (Phase M) decouples label from storage value: old data reads as `pm`/`am`, new code reads via `TIERS.advanced.storageValue === 'adv'`.
- **REQ-TA-006** Lookup-key pattern: `getLookupKey(tier, kind)` returns `STRIPE_PRICE_{N}` or `STRIPE_PRICE_{N}_RENEWAL`. Used by Stripe integration to resolve env-var-stored price IDs.
- **REQ-TA-007** Env-var routing split: staging uses `STAGING_PREFIX`-prefixed env vars when set; production uses base names. Tier resolution must consult the resolved prefix.

## Non-Functional Requirements

- **NFR-TA-001** `TIERS` is `as const` — no mutation possible at runtime.
- **NFR-TA-002** Adding a tier compiles zero TS errors thanks to type auto-extension (REQ-TA-003).
- **NFR-TA-003** Tier label rendering goes through `tierLabelFor()` — never hard-coded "Advanced"/"Basic" in user-facing strings.

## Acceptance Criteria

1. Adding a new tier `{ slug: 'premium', label: 'Premium', storageValue: 'prem' }` extends `MembershipPlan` automatically.
2. Renaming `advanced.label` to "Pro" updates all UI without touching Sheets data.
3. `getTier('nonexistent')` throws `UnknownTierError`.
4. `tierLabelFor('adv')` returns "Advanced" (label, not storage value).
5. Stripe webhook dispatches based on `tier` metadata, not `plan`.

## Out of Scope

- Per-tier pricing logic beyond env-var lookup.
- Per-tier feature gating (future enhancement).
- Per-tier admin permissions (Sheets-based; no per-tier auth).

## Related

- `src/lib/forms/tiers.ts` — implementation
- `.wolf/cerebrum.md` — Phase K (defence-in-depth rationale), Phase M (rename)
- `.wolf/buglog.json` — bug-003 (UnknownTier default)