# Adding a new membership tier

Each tier in Re:Member owns its display label, Stripe prices, sheet tabs, and renewal/application schemas. Adding a third tier is mostly a config change — but a few engineering touchpoints follow.

## 1. Add the entry to `src/lib/forms/tiers.ts`

Open `src/lib/forms/tiers.ts` and add a new key to `TIERS`:

```ts
export const TIERS = Object.freeze({
  advanced: { /* existing */ },
  basic:    { /* existing */ },
  student: {                          // ← new
    slug: "student",
    label: "Student Membership",
    shortLabel: "Student",
    storageValue: "student",          // ← written to the Renewals sheet tier column; lowercase, stable forever
    priceEnvVar: "STRIPE_PRICE_STUDENT",
    renewalPriceEnvVar: "STRIPE_PRICE_STUDENT_RENEWAL",
    applicationSchemaId: "studentApply",
    renewalSchemaId: "renewStudent",
    sheetName: "Student Applications",
    renewalSheetName: "Renewals",
  },
});
```

Each field matters:

- `storageValue` is the value written to the Renewals sheet's `tier` column AND Stripe `metadata.tier`. Pick a short lowercase code that doesn't collide with `"adv"` or `"basic"` (or the legacy `"pm"`/`"am"` values, which old rows still carry — `renewal-sheet.ts`'s `legacyTierMap` maps them on read). The reader (`getRenewalById`) is data-driven — your new value is automatically recognised.
- `priceEnvVar` + `renewalPriceEnvVar` point to the Stripe price IDs you create in step 2.
- `applicationSchemaId` + `renewalSchemaId` are the schema ids you create in step 3.

## 2. Create the Stripe products

In the Stripe Dashboard, create one Product per tier flow:

- **Application product** with a recurring annual price in NZD. Copy the price ID into `.env` as `STRIPE_PRICE_STUDENT=<price_id>`.
- **Renewal product** with a recurring annual price in NZD. Copy the price ID into `.env` as `STRIPE_PRICE_STUDENT_RENEWAL=<price_id>`.

Add both env vars to `.env.example` so the next deployer knows about them.

## 3. Create the schemas

Create `src/lib/forms/schemas/studentApply.{ts,content.json}` and `src/lib/forms/schemas/renewStudent.{ts,content.json}`. Use `renewBasic` and `basicApply` as templates. The `columnMap` must point at columns in the new sheet (or the shared Renewals sheet, for renewals).

## 4. Update CUSTOMIZE.md

Add the new tier to the env-var table in section 1 (`ORG_NAME` etc.) and section 5 (`STRIPE_PRICE_*`). Non-developers reading the deploy checklist should see the new vars.

## 5. (Optional) Add a fallback Stripe price env var

If you want a `LookupKey`-style alternative (older code paths), see `src/lib/stripe-products.ts`. The Phase D `resolveRenewalPriceByTier(tierSlug)` is the new tier-driven path and needs no extra mapping.

## 6. Tests

- `src/lib/forms/tiers.test.ts` — add an assertion that `getTier("student")` returns the new config; `listTiers()` now includes 3 entries.
- `src/lib/forms/schemas/renewStudent.test.ts` — schema-level tests (see `renewBasic.test.ts` for the pattern).
- `src/lib/stripe-products.test.ts` — `resolveRenewalPriceByTier("student")` reads `STRIPE_PRICE_STUDENT_RENEWAL`.

## What's automatic once the entry is added

- `getTier(slug)` returns your config
- `validateTier(slug, body)` picks the right schema
- `getRenewalById` recognises your storageValue
- `checkout/[tier].astro` and `checkout/[tier].ts` route your slug
- Tier-aware email templates can look up `getTier(slug).label` and `getTier(slug).storageValue`