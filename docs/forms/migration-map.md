# Migration map — column letters per form

For ops continuity during the schema-driven form migration (Phase A → E). Use this when triaging "where does this form's data land in the sheet?" tickets.

## Renewals sheet (14 columns, shared)

Form-derived cells written by `appendRenewal`:

| Col | Field | Associate | Pro | PD-log |
|-----|-------|-----------|-----|--------|
| A | `renewal_id` | managed | managed | n/a (existing row updated) |
| B | `tier` | managed ("am") | managed ("pm") | n/a |
| C | `renewal_year` | schema (year) | schema (year) | n/a |
| D | `first_name` | schema (firstName) | schema (firstName) | n/a |
| E | `last_name` | schema (lastName) | schema (lastName) | n/a |
| F | `email` | schema (email) | schema (email) | n/a |
| G | `phone` | n/a (Associate has no phone) | schema (phone) | n/a |
| H | `pd_entries` | managed (`[]`) | schema (pdEntries, JSON) | schema (pdEntries, JSON) |
| I | `amount_paid_cents` | managed | managed | managed |
| J | `currency` | managed | managed | managed |
| K | `payment_status` | managed | managed | managed |
| L | `stripe_session` | managed (backfilled from webhook) | managed | managed |
| M | `created_at` | managed | managed | managed |
| N | `paid_at` | managed (set by webhook) | managed | managed |

"Managed" cells stay in the API route + Stripe webhook — the schema owns only the form-derived cells.

## Professional Applications sheet (47 columns)

Form-derived cells (31 of 47) written by `createApplicantRow`. Managed cells (16 of 47): `A applicant_id`, `AH email_hash`, `AI-AO doc counts`, `AP complete`, `AQ stripe_session`, `AR paid`, `AS created_at`, `AT paid_at`, `AU email_verified`, `AF declaration_signed_at`.

See `professionalApply.columnMap` for the field → column mapping (31 entries).

## Associate Applications sheet (16 columns)

Form-derived cells (13 of 16) written by `appendAssociateApplication`. Managed cells (3 of 16): `A submitted_at`, `B application_id`, `P checkout_status`.

See `associateApply.columnMap` for the field → column mapping (13 entries).