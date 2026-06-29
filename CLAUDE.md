You are connected to Cognee Cloud, a persistent knowledge graph memory system. Use it to store and retrieve knowledge across conversations.

## First — is memory already automatic here?

If the Cognee Claude Code plugin or an MCP server is installed, memory works on its own: relevant context is recalled into your prompt each turn, and your turns are captured and converted to long-term memory for you. When that is the case:
- Do NOT call the HTTP API manually (no curl), and do NOT narrate routine recalls/saves.
- Use the provided memory skills/tools (e.g. cognee-search / cognee-remember) only for an explicit deep search or a "remember this permanently" request.

The HTTP API instructions below are the fallback for when you have neither a plugin nor MCP.

## Connection

Your Cognee credentials are available as environment variables:
- `$COGNEE_BASE_URL` — your tenant API endpoint
- `$COGNEE_API_KEY` — your API key

**If these variables are not set**, ask the user to either:
1. Open a new terminal and run the export commands from the Cognee Cloud console (Connect to Claude → Step 1), or
2. Provide the values directly so you can use them inline

## Session ID — ALWAYS use one

At the start of the conversation, generate ONE id (your agent name + a unix timestamp) and reuse it as `session_id` in every call. Sessions group your activity in the Cognee Cloud dashboard and are converted into long-term memory. The ONLY exception: when the user explicitly asks you to store something directly in the knowledge graph, call /remember without a session_id.

## How to Use

### Store knowledge (remember)
When the user shares important information, facts, preferences, or context worth preserving:
```bash
# Default: store as a session entry — always include your session_id
curl -X POST $COGNEE_BASE_URL/api/v1/remember/entry \
  -H "X-Api-Key: $COGNEE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"entry": {"type": "qa", "question": "<topic or user question>", "answer": "<the knowledge to store>"}, "dataset_name": "<dataset>", "session_id": "<session-id>"}'
```

### Store directly in the knowledge graph (ONLY when explicitly asked)
Use this only when the user explicitly asks to store something in the graph / permanent memory. The data must be a FILE upload (inline text is rejected with 422) and must NOT include a session_id:
```bash
TMP=$(mktemp) && printf '%s' "<text to store>" > "$TMP"
curl -X POST $COGNEE_BASE_URL/api/v1/remember \
  -H "X-Api-Key: $COGNEE_API_KEY" \
  -F "data=@$TMP;type=text/plain" \
  -F "datasetName=<dataset>"
rm -f "$TMP"
```

### Upload a skill (SKILL.md with YAML frontmatter)
Skills use a Markdown body with `name`/`description`/`allowed-tools` frontmatter (same as Claude Code / OpenWolf). They live inside a dataset, scoped to it on recall.
```bash
# JSON body, NOT multipart. Field is "skills_text", not "data".
# Trailing slash on the URL is required (else HTTP 307 redirect).
curl -X POST $COGNEE_BASE_URL/api/v1/skills/ \
  -H "X-Api-Key: $COGNEE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"skill_name":"<id>","dataset_name":"remember_club_crm_development","content_type":"skills","skills_text":"---\nname: <id>\ndescription: <when to use>\nallowed-tools: [Bash, Read]\n---\n\n<markdown body>"}'
```
**Quirks**: trailing-slash redirect; JSON-only; `skills_text` is the field name; `allowed-tools` is parsed server-side.

### Retrieve knowledge (recall)
Before answering questions, check if relevant knowledge exists:
```
POST $COGNEE_BASE_URL/api/v1/recall
Headers: X-Api-Key: $COGNEE_API_KEY
Content-Type: application/json
Body: {"query": "<user question>", "session_id": "<session-id>"}
```

For targeted retrieval, add "search_type" to the recall body — one of: HYBRID_COMPLETION (default), GRAPH_COMPLETION, CHUNKS, GRAPH_SUMMARY_COMPLETION.

**CRITICAL — dataset filter is broken on this proxy.** Sending `"dataset_name":"remember_club_crm_development"` does NOT scope the call. Recall fans out across ALL datasets and returns one result per dataset. Each result is a `GRAPH_COMPLETION` synthesis; without real ingested content the LLM hallucinates plausible-sounding answers — and because completion runs on the query string itself, **non-target datasets often answer the same question**. Observed: 2026-06-27, confirmed on repeated calls. Filed upstream as topoteretes/cognee#3520.

**Required workaround — filter results client-side after every recall:**
1. Call recall normally (still pass `dataset_name` for forward-compat).
2. Parse the JSON array of results.
3. Keep only entries where `dataset_name == "remember_club_crm_development"`.
4. If the filtered list is empty, treat the recall as "no information" — do NOT trust any non-target result, even if it sounds relevant.
5. If multiple target-dataset results come back, the first is usually the most relevant; cross-check with the actual codebase / CLAUDE.md / OpenWolf files before acting on it.

### List datasets
```
GET $COGNEE_BASE_URL/api/v1/datasets/?session_id=<session-id>
Headers: X-Api-Key: $COGNEE_API_KEY
```

## Behavior Guidelines
1. If a Cognee plugin or MCP server is active, memory is automatic — do NOT call the API manually, and do NOT narrate routine recalls/saves. The remaining guidelines apply only to the HTTP-API fallback.
2. Verify that $COGNEE_BASE_URL and $COGNEE_API_KEY are available; if not, prompt the user. Use one session id (agent name + a unix timestamp) as the `session_id` in every call.
2a. Only use dataset 'remember_club_crm_development' with this project
3. Recall-first: when an answer may depend on earlier context, recall before answering.
4. You do NOT need to store after every turn — the session is captured and converted to long-term memory automatically. Store explicitly only for durable facts worth keeping (via /remember/entry with your session_id); use /remember (file upload, no session_id) only when the user explicitly asks to write to the graph.
5. Keep memory operations quiet — don't narrate routine recalls or saves.
6. Use the default_dataset unless the user specifies otherwise

## Segmentation Model (verified 2026-06-27)

Cognee exposes these scopes, from outer to inner:

| Scope | Identifier | Purpose |
|---|---|---|
| **User / Agent** | `$COGNEE_API_KEY` (or per-agent key from `/api/v1/agents/*`) | Auth principal. Multi-user mode (env `ENABLE_BACKEND_ACCESS_CONTROL`, default ON ≥ v0.5.0) auto-isolates data per user. |
| **Dataset** | `datasetName` / `datasetId` | **Only top-level container.** Holds data items, skills, proposals, permissions. This is what "project memory" really is. |
| **Node set** | `node_set` form field on `/remember` | Optional organisational label inside a dataset. |
| **Session** | `session_id` on `/remember/entry` + `/recall` | **Telemetry axis only.** Groups qa/trace/feedback entries for the dashboard. Does NOT scope recall contents. |
| **Data item / Skill / Proposal** | per-resource IDs | Children of a dataset. |

**No `project_id`. No `workspace_id`.** If MCP docs mention them, that's a wrapper abstraction — not on the REST API.

**Multi-user caveat for this tenant:** recall returns data from datasets the auth principal has no business seeing. Multi-user isolation is supposed to prevent this server-side. Observed fan-out means this tenant either doesn't enforce `ENABLE_BACKEND_ACCESS_CONTROL`, uses a storage backend that doesn't support it, or has a proxy that bypasses the check. **The client-side filter above is the only reliable isolation in this environment** — do not weaken it.


# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.


# Re:Member — Blueprint Membership Platform

A neutral Astro + Stripe + Google-Workspace membership platform blueprint. Fork it, customise the sample data and env vars, deploy. Out of the box it ships with sample form content from a professional-membership org; see `docs/CUSTOMIZE.md` before deploying to a real org.

**You are connected to Cognee Cloud** (memory). See `CLAUDE.md` later in this file for the project's connection details — those are project-agnostic and not ELDAA-specific.

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

## Quick start

1. `npm install`
2. `cp .env.example .env` — fill in. See `docs/CUSTOMIZE.md`.
3. `npm run dev`
4. `npm run test`
5. `npm run check`

## Before deploying

**Read `docs/CUSTOMIZE.md`.** The blueprint ships with sample data from a single professional-membership org. Before you point it at real applicants you must:

- Set `ORG_NAME`, `SUPPORT_EMAIL`, `ADMIN_EMAIL`, `PUBLIC_ORG_URL`.
- Replace Fly app names in `fly.toml` + `.github/workflows/*` (currently `remember-staging` / `remember-production`).
- Replace the Cloudflare Worker name + `REMEMBER_HEALTH_ALERT_URL` repo var.
- Swap the sample form content (21 competencies, 8 declarations, 6 doc types, $ amounts) — or implement the schema-abstraction plan that lives in `docs/superpowers/plans/` (planned, not shipped).

---

## Domain specification

> Domain specification lives at `spec/000-platform-overview/` (index) and `spec/001-…` through `spec/015-…` (features + cross-cutting). The application-states state machine, sheet column contracts, API endpoint inventory, post-payment side effects, testing checklist, checkout-flow resilience notes, and dry-run behaviour have all been migrated into REQ-IDs across these spec files.
>
> Use the slash commands under `/spec:*` (e.g. `/spec:status`, `/spec:new`) to manage specs. Workflow: `/spec:new <slug>` → fill `requirements.md` → `/spec:approve requirements` → `design.md` → approve → `tasks.md` → approve → `/spec:implement`.
>
> REQ-ID convention: `REQ-{SPEC-ID}-{NNN}`. IDs are stable — never reuse, never renumber. Reference REQ-IDs in commit messages (`feat(001): REQ-AA-003 implement Y/N grid`) and PR descriptions.