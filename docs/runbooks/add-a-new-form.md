# Runbook — Add a new form to the platform

Use this when adding a form that doesn't fit the existing renewal/application archetypes (e.g. a feedback survey, a one-off event signup, a custom data-capture form).

## Checklist

- [ ] **Pick a sheet tab name.** Conventions: kebab-case OR PascalCase (match existing tabs in your spreadsheet). Document the column layout in this runbook once you've decided.
- [ ] **Decide if it needs uploads.** If yes, list the doc types and which are required vs optional. Plan a Drive folder for file storage.
- [ ] **Decide if it needs auth.** Forms with sensitive data should require a `resume_token` (token-gated via query string) — see `src/pages/renew/[tier].astro` for the pattern.
- [ ] **Decide if it needs autosave.** Long forms (>5 steps) should autosave every blur to avoid data loss on browser close.
- [ ] **Create the schema files.** `src/lib/forms/schemas/<id>.ts` + `<id>.content.json`. Use `example.memberSurvey.ts` as the template.
- [ ] **Write the schema tests.** `<id>.test.ts` — happy path, missing fields, CR/LF email, toRow column letters, managed-cell exclusion.
- [ ] **Create the Astro page.** `src/pages/<route>.astro`. Use `loadSchema("<id>")` in the frontmatter, render via `<Step>` + `<FieldRenderer>`. Initial values from URL params if applicable.
- [ ] **Create the API route.** `src/pages/api/<route>.ts`. Use `validateTier` (or `validate` with the schema directly) for body validation. Use `toRow` if the sheet writer takes positional args, or pass `result.values` if it takes named args.
- [ ] **Wire up the sheet writer.** Either reuse `appendRenewal` / `createApplicantRow` / `appendAssociateApplication` (named-arg adapters) or write a new `appendX` function in `src/lib/`.
- [ ] **Add a "log entry" doc generation** (optional). If the org wants an auto-generated review Doc per submission, call `createApplicationReviewDoc` from `src/lib/google-docs.ts`.
- [ ] **Update CUSTOMIZE.md.** Add any new env vars to section 1 + section 5. Add the schema to section 7a.
- [ ] **Update docs/forms/migration-map.md.** Document the sheet tab + column layout.
- [ ] **Test end-to-end on staging.** Submit a real form, verify the sheet row, verify the email, verify the resume link (if applicable).

## When NOT to use this runbook

- **Adding a renewal tier** → use `docs/forms/composing-a-tier.md` instead.
- **Editing labels/options/order of an existing form** → just edit the `.content.json`. No code review required.
- **Adding a doc type to an existing form** → edit `schema.uploads.docTypes` in the TS file + update the upload page's doc-type list.