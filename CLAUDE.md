# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.


# Re:Member — Blueprint Membership Platform

A neutral Astro + Stripe + Google-Workspace membership platform blueprint. Fork it, customise the sample data and env vars, deploy. Out of the box it ships with sample form content from a professional-membership org; see `docs/CUSTOMIZE.md` before deploying to a real org.

---

## What this repo is

End-to-end member lifecycle for a small membership org:

- **Associate membership signup** — one-page Stripe checkout.
- **Professional membership application** — 8-step wizard with multi-file document upload, autosave, resume-by-token, admin review via auto-generated Google Doc.
- **Annual renewal** — two tiers, one-time payment, hosted Payment Links.
- **PD (professional development) logging** — members log PD entries post-renewal; admins notified.
- **Post-payment side effects** — webhook → Sheets logging + Doc review + resume-link emails.
- **Health check + alerting** — `/api/health` probes Stripe + email; Cloudflare Worker cron posts failures to Slack.

Sheets-as-DB. Drive-as-DMS. No CMS. Volunteer admin runs it from the spreadsheet.

## Stack

Astro SSR · TypeScript · Tailwind · Stripe Checkout · Google Sheets/Drive/Docs (SA + DWD) · Mailgun / Gmail · Fly.io · Cloudflare Worker · Vitest.

## Before deploying

Read `docs/CUSTOMIZE.md`. Replace org name, emails, Fly app names, Cloudflare Worker name, and sample form content (21 competencies, 8 declarations, 6 doc types, $ amounts) — or implement the schema-abstraction plan in `docs/superpowers/plans/`.

---

## Domain specification

> Domain specification lives at `spec/000-platform-overview/` (index) and `spec/001-…` through `spec/015-…` (features + cross-cutting). The application-states state machine, sheet column contracts, API endpoint inventory, post-payment side effects, testing checklist, checkout-flow resilience notes, and dry-run behaviour have all been migrated into REQ-IDs across these spec files.
>
> Use the slash commands under `/spec:*` (e.g. `/spec:status`, `/spec:new`) to manage specs. Workflow: `/spec:new <slug>` → fill `requirements.md` → `/spec:approve requirements` → `design.md` → approve → `tasks.md` → approve → `/spec:implement`.
>
> REQ-ID convention: `REQ-{SPEC-ID}-{NNN}`. IDs are stable — never reuse, never renumber. Reference REQ-IDs in commit messages (`feat(001): REQ-AA-003 implement Y/N grid`) and PR descriptions.
