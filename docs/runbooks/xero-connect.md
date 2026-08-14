# Connecting Xero (Demo Company and production)

Use this to stand up the Stripe→Xero sync in a new environment: connecting
the Xero Demo Company for staging validation, and later the real
organisation at production cutover.

Implementation plan and task numbering: `spec/016-xero-integration/`.

## When to use this

- First connection of a Xero org to staging or production
- Re-consenting after the auth-code refresh token expired (~60 days idle) or
  was lost
- Rotating `XERO_CLIENT_SECRET`, `XERO_SYNC_SECRET`, or `XERO_CONSENT_SECRET`
- Demo Company reset wiped the connection

---

## Choosing an auth mode

Both are implemented behind one interface (`src/lib/xero-auth.ts`), selected
by `XERO_AUTH_MODE`.

| | `custom` (Custom Connection) | `authcode` (standard OAuth2) |
|---|---|---|
| Grant | `client_credentials` | `authorization_code` + `refresh_token` |
| Consent | None — machine to machine | One-time browser consent |
| Refresh token | None | Rotates on **every** use, dies after ~60 days idle |
| Orgs | Exactly one | Multiple possible |
| Cost | Paid monthly add-on per connection — **except the Demo Company, which is free for development** | Free |
| Availability | AU, NZ, UK, US only | Anywhere |

**Custom Connections do work with the Demo Company**, free, and they don't
count toward the two-uncertified-app limit. That means you can validate the
*same* auth mode in staging that you intend to run in production — worth
doing, rather than exercising the auth-code path in staging and shipping the
custom-connection path to prod untested.

`custom` is the better shape for this app: no consent flow, no rotating token
to lose, no 60-day idle expiry on a machine that scales to zero. `authcode`
exists as the free fallback and for the case where the Custom Connections
add-on isn't wanted.

---

## Demo Company caveats

**It resets every 28 days**, automatically, and you can reset it manually at
any time. Everything you add is deleted on reset — invoices, contacts,
payments, and the connection itself. Plan staging validation as a single
sitting, not something spread over a month.

**There is no Stripe bank feed.** You cannot connect a real feed to Demo
Company. Create a manual bank account to stand in for the clearing account
(Accounting → Bank Accounts → Add Bank Account, name it e.g. "Stripe
Clearing"). Payments will apply correctly and every staging assertion about
invoice totals, dates, idempotency and resume behaviour is still valid.

What you **cannot** validate in Demo Company:

- Feed charge lines auto-matching the payments
- The clearing account netting to zero after a payout
- Bank rules coding Stripe fees

Those are production-only checks and belong to the production cutover.

---

## 1. Create the Xero app

<https://developer.xero.com/app/manage> → **New app**

- **Custom connection**: choose that integration type, and select the Demo
  Company as the organisation. No redirect URI is needed — there is no
  browser flow.
- **Web app** (for `authcode`): set the redirect URI to exactly
  `https://<your-fly-app>.fly.dev/api/xero/oauth/callback` for staging, or
  `https://members.example.org/api/xero/oauth/callback` for production.
  It must match `XERO_REDIRECT_URI` character for character.

Either way you get a **Client ID** and **Client Secret**.

## 2. Enable the Demo Company

In Xero: top-right org menu → **My Xero** → **Demo Company**. Choose the
**same region as the production org** so sales-tax behaviour and the default
chart of accounts match.

## 3. Collect the config values

Use the API Explorer (<https://api-explorer.xero.com>), which handles auth
for you. Three calls:

| Call | Gives you |
|---|---|
| `GET /Accounts` | `AccountID` (UUID) of the clearing account → `XERO_STRIPE_FEED_ACCOUNT_ID`, and the revenue account **code** → `XERO_SALES_ACCOUNT_CODE` |
| `GET /TaxRates` | the org's real zero/no-tax `TaxType` → `XERO_TAX_TYPE` |
| `GET /connections` | the org's `tenantId` → `XERO_TENANT_ID` |

Three traps, each of which fails silently rather than erroring:

- **`XERO_STRIPE_FEED_ACCOUNT_ID` is the UUID, not the account code.** The
  Xero UI never shows the UUID; that is why this goes through the API
  Explorer. `XERO_SALES_ACCOUNT_CODE` is the opposite — the short code
  (e.g. `200`), not a UUID.
- **Do not assume `TaxType: "NONE"`.** Read what the org actually returns.
  It is env-overridable precisely so this is a config change, not a code
  change.
- **`GET /connections`: confirm the field is `tenantId`, not the
  connection's own `id`.** `src/lib/xero-auth.ts` reads `tenantId`. If that
  is the wrong field the tenant guard silently never matches, and nothing
  ever reaches Xero. This is an open unverified item flagged in-code in
  `resolveTenantId`.

## 4. Set the secrets

Staging (Demo Company), custom-connection mode:

```bash
fly secrets set -a <your-fly-app> \
  XERO_ENABLED=true \
  XERO_AUTH_MODE=custom \
  XERO_ALLOW_LIVE=false \
  XERO_CLIENT_ID=... \
  XERO_CLIENT_SECRET=... \
  XERO_TENANT_ID=... \
  XERO_SALES_ACCOUNT_CODE=200 \
  XERO_STRIPE_FEED_ACCOUNT_ID=... \
  XERO_TAX_TYPE=... \
  XERO_SYNC_SECRET="$(openssl rand -hex 32)" \
  XERO_CONSENT_SECRET="$(openssl rand -hex 32)"
```

For `XERO_AUTH_MODE=authcode`, add:

```bash
  XERO_REDIRECT_URI=https://<your-fly-app>.fly.dev/api/xero/oauth/callback
```

**`XERO_ALLOW_LIVE=false` is the guard that stops a live-mode Stripe event
ever reaching the Demo Company.** It must be `false` on staging and `true` on
production. `assertEnvironmentSafe` compares it against the Stripe event's
`livemode` and refuses to act on a mismatch; the tenant check is the second
layer.

`XERO_CONSENT_SECRET` is only used by `authcode`, but harmless to set either
way.

### Why two separate secrets

`XERO_SYNC_SECRET` gates the sweeper via the `X-Sync-Secret` header.
`XERO_CONSENT_SECRET` gates `/api/xero/oauth/start` via a **query parameter**,
because consent is a redirect a human follows in a browser and a link click
cannot attach a header. The query value lands in Fly access logs, so it must
not be the same value as the sweeper's — rotate it after connecting.

Both fail closed: an unset secret denies every request rather than opening
the endpoint.

## 5. Connect

**`custom` mode**: nothing to do. The first Xero call fetches a token itself.

**`authcode` mode**: open in a browser

```
https://<your-fly-app>.fly.dev/api/xero/oauth/start?secret=<XERO_CONSENT_SECRET>
```

Approve, and pick the Demo Company on the org-selection screen. On success
the callback stores the refresh token in the **Xero Auth** sheet tab and
tells you to rotate the consent secret. Do that.

## 6. Verify

```bash
curl -s -H "X-Sync-Secret: $XERO_SYNC_SECRET" \
  https://<your-fly-app>.fly.dev/api/xero/sync-pending
```

Expected: `{"enabled":true,"swept":0,"done":0,"stillPending":0,"permanentFailures":0}`

| Response | Meaning |
|---|---|
| `401` | Wrong or unset `XERO_SYNC_SECRET` |
| `{"enabled":false,...}` | `XERO_ENABLED` is off. Reported rather than 404'd so the cause is visible in the trigger log |
| `500` with `MISSING_CONFIG` | A required `XERO_*` var is unset |
| `500` with `XERO_TENANT_MISMATCH` | The token cannot see `XERO_TENANT_ID` — wrong org, or the `/connections` field trap above |

Then run a test payment end-to-end and work through the staging-validation
checklist in `spec/016-xero-integration/tasks.md`.

## 7. Schedule the sweeper

See `apps-script/xero-sweeper/README.md`. Set `APP_BASE_URL` and
`XERO_SYNC_SECRET` in Script Properties, run `sweepXeroPending` once to
authorize, then `installTrigger`.

---

## Rotating secrets

| Secret | How |
|---|---|
| `XERO_CONSENT_SECRET` | `fly secrets set` a new value. No reconnection needed |
| `XERO_SYNC_SECRET` | `fly secrets set`, then update the Apps Script Script Property to match, or the hourly sweep starts 401ing |
| `XERO_CLIENT_SECRET` | Regenerate in the developer portal, `fly secrets set`. In `authcode` mode you must then re-consent via step 5 |

## Recovering a broken auth-code connection

Symptom: `XERO_NOT_CONNECTED` or repeated `XERO_TOKEN_FAILED: 400
invalid_grant` in the logs.

The refresh token rotates on every use and is stored in the **Xero Auth**
tab. If a rotation was lost — the write failed, or the tab was edited by hand
— the stored token is dead and there is no recovery except re-consenting.
Re-run step 5. Rows left `pending` in **Xero Sync** are picked up by the next
sweep once auth works again; nothing is lost.

This failure mode does not exist in `custom` mode, which is the main
operational argument for it.

## Related

- Spec: `spec/016-xero-integration/`
- Sweeper trigger: `apps-script/xero-sweeper/README.md`
- Auth: `src/lib/xero-auth.ts`, token storage `src/lib/xero-token-store.ts`
- Orchestration: `src/lib/xero-sync.ts`, queue tab `src/lib/xero-sync-sheet.ts`

Sources for the Demo Company and Custom Connections constraints above:
[Use the demo company](https://central.xero.com/0/article/Use-the-demo-company),
[Custom Connections](https://developer.xero.com/documentation/guides/oauth2/custom-connections/),
[Development accounts](https://developer.xero.com/documentation/development-accounts/).
