# Mailgun setup for ELDAA transactional email

Replaces the previous Gmail OAuth path. Use this when standing up Mailgun
for a new environment, rotating the API key, or moving from a sandbox
domain to a production verified domain.

## When to use this

- `/api/health` returns `email: not_configured` (env vars missing) or
  `email: disconnected` (probe failing)
- Rotating the Mailgun private API key after a suspected leak
- Promoting a Mailgun sandbox domain to a real verified domain (sandbox
  domains only deliver to verified recipients; production needs a real
  domain)

## Prerequisites

- A Mailgun account in the **US** region (uses `api.mailgun.net`).
  For EU accounts, switch the health probe URL in
  `src/pages/api/health.ts` to `https://api.eu.mailgun.net/v3/{domain}`.
- A verified sending domain in Mailgun (e.g. `mg.eldaa.org.nz`).
  Sandbox domains look like `sandbox<id>.mailgun.org` and only deliver
  to recipients you've explicitly added in the Mailgun dashboard.

## 1) Get the API key

Mailgun dashboard → Settings → API Keys → "Private API key". Copy
the value (it starts with `key-`).

If the key was ever pasted in chat or committed to git, treat it as
leaked: rotate it in the same screen before continuing.

## 2) Set DNS records for the sending domain

Mailgun dashboard → Sending → Domains → `<your domain>` → DNS records.
Add the records it lists (SPF, DKIM, MX for receiving if needed):

| Type | Host | Value |
|------|------|-------|
| TXT  | `mg` (or `@` for apex) | `v=spf1 include:mailgun.org ~all` |
| TXT  | `krs._domainkey.mg` | Mailgun-provided DKIM public key |
| TXT  | `mg` | Mailgun-provided `_dmarc` record (optional) |

Propagation is usually minutes but can take up to 48h. Mailgun verifies
the domain in its dashboard once records resolve.

## 3) Roll the env vars to Fly

```sh
fly secrets set -a eldaa \
  MAILGUN_API_KEY=key-... \
  MAILGUN_DOMAIN=mg.eldaa.org.nz \
  MAILGUN_FROM="ELDAA <no-reply@mg.eldaa.org.nz>"

fly secrets set -a eldaa-production \
  MAILGUN_API_KEY=key-... \
  MAILGUN_DOMAIN=mg.eldaa.org.nz \
  MAILGUN_FROM="ELDAA <no-reply@mg.eldaa.org.nz>"
```

Restart the running machine so the new secrets are injected:

```sh
fly machine list -a eldaa
fly machine stop <started-id> -a eldaa
# next request cold-starts a fresh machine with the new env
```

## 4) Unset the old Gmail env vars (if migrating from a Gmail setup)

```sh
fly secrets unset -a eldaa \
  GMAIL_OAUTH_CLIENT_ID GMAIL_OAUTH_CLIENT_SECRET \
  GMAIL_OAUTH_REFRESH_TOKEN GMAIL_SENDER_EMAIL

fly secrets unset -a eldaa-production \
  GMAIL_OAUTH_CLIENT_ID GMAIL_OAUTH_CLIENT_SECRET \
  GMAIL_OAUTH_REFRESH_TOKEN GMAIL_SENDER_EMAIL
```

## 5) Verify

Health check — expect `email: connected`:

```sh
curl -sS https://subscribe-test.eldaa.org.nz/api/health | python3 -m json.tool
curl -sS https://subscribe.eldaa.org.nz/api/health | python3 -m json.tool
```

End-to-end — trigger an email and confirm it arrives + the sheet audit
log gets a row:

```sh
# In the apply form: start a no-token registration, then check the
# recipient's inbox. Or for a faster test, use the apply endpoint with
# an applicant ID that triggers a confirmation email.
fly logs -a eldaa --no-tail | grep -E "Mailgun|email"
```

## 6) Sandbox caveats

A Mailgun sandbox domain only delivers to recipients you've added in
the dashboard. To smoke-test on staging with a sandbox domain, add the
test recipient in Mailgun first. For real applicant traffic, the
sandbox is not viable — promote the account to a verified custom
domain before rolling to production.

## 7) Deliverability — first sends go to Junk

For a brand-new sending domain (`mg.eldaa.org.nz` on day 1), even
with **DKIM + SPF + DMARC all passing**, the first handful of sends
to any recipient are likely to land in Junk. This is not a config
issue — authentication headers and DNS records are independent of
sender reputation.

Symptoms to look for in the message headers:

```
X-Apple-MoveToFolder: Junk
X-ICL-Score: 4.33              # iCloud spam score (over ~3 = junk)
X-Spam-Flag: yes
Authentication-Results: ...; dkim=pass spf=pass dmarc=pass
```

All three authentication checks can say `pass` and the message still
goes to Junk. The classifier is weighing content + sender reputation,
not DNS.

Mitigations (in order of leverage):

1. **Sender reputation** — the only durable fix. Volume of legitimate
   sends + recipient "Not Junk" + add to contacts builds the
   domain's reputation over days/weeks. No way to shortcut this.
2. **From name** — use a recognisable brand ("ELDAA Membership
   Notifications"), not "No Reply" or "noreply". Generic names are
   penalised by content classifiers.
3. **List-Unsubscribe header** — RFC 8058. Optional for transactional
   but a positive signal for Gmail and Apple. Drop-in for
   `email-sender.ts`:
   ```ts
   "h:List-Unsubscribe": "<mailto:unsubscribe@mg.eldaa.org.nz>",
   "h:List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
   ```
4. **Recipient training** — first time an applicant receives an
   ELDAA email, ask them to mark "Not Junk" + add
   `no-reply@mg.eldaa.org.nz` to contacts. This is a one-time ask
   that unblocks the rest of their journey.

Magic-link auth messages are inherently shape-matched to phishing
("click here to continue" + token in URL). Sender reputation is the
main lever — there is no header or template change that will fully
defeat this on a new domain.

## 8) Rollback

```sh
# 1) Roll Gmail env vars back on
fly secrets set -a eldaa \
  GMAIL_OAUTH_CLIENT_ID=... GMAIL_OAUTH_CLIENT_SECRET=... \
  GMAIL_OAUTH_REFRESH_TOKEN=... GMAIL_SENDER_EMAIL=...

# 2) Drop Mailgun vars
fly secrets unset -a eldaa \
  MAILGUN_API_KEY MAILGUN_DOMAIN MAILGUN_FROM

# 3) Revert the code change
git revert <commit-hash>
```

The codebase is also pinned to this runbook — if you roll back, the
Gmail re-consent procedure from the old
`gmail-oauth-token-rotation.md` (now removed) is in the git history.
Look up the runbook via `git log --diff-filter=D --name-only -- docs/runbooks/`.

## Related

- `src/lib/email-sender.ts` — Mailgun HTTP API client (uses
  `mailgun.js` SDK)
- `src/pages/api/health.ts` — Mailgun probe (`GET /v3/{domain}`)
- `.run/health-alert-worker/worker.mjs` — Cloudflare cron that alerts
  when `email` is not `connected`
