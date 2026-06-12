# Gmail OAuth token rotation and Fly secret rollout
Use this when resume-link emails fail, sender identity is wrong, or you need to rotate Gmail OAuth credentials.

## Which GCP project owns the OAuth client

The Gmail OAuth client lives in GCP project **`mystical-runway-496019-r8`** (project number `531470041058`). The other project in this repo, `stripe-billing-491503`, is for Stripe billing only — Sheets/Drive writes go through a service account there, not OAuth. Don't get them mixed up.

The client secret file you want is:

```
~/Downloads/client_secret_531470041058-do9qba7t3c2osmrrri5i0dlhe9nk819u.apps.googleusercontent.com.json
```

If that's missing, download a fresh one from GCP console → project `mystical-runway-496019-r8` → APIs & Services → Credentials → the "Desktop" OAuth 2.0 Client ID. Drop it anywhere on disk and point `CLIENT_JSON` at it.

## Why this runbook exists

OAuth refresh tokens for Google don't expire on a schedule — they last until revoked. Common revocation triggers:
- Token unused past Google's purge window (rumored ~6 months of inactivity)
- `no-reply@eldaa.org.nz` password or MFA change
- Someone removes the app from that account's Authorized Apps
- The OAuth client or GCP project is deleted
- OAuth consent requests Google Cloud scopes (for example `cloud-platform`) and the Workspace admin has a Cloud session-length policy; this often surfaces as `invalid_grant` / `invalid_rapt` about every 24h

Detection is automated: `src/pages/api/health.ts` exercises the refresh token on every call, and the `eldaa-health-alert` Cloudflare Worker pings it on a cron and posts to Slack on failure. If Slack pings you about `gmail: disconnected`, run this runbook.

## 1) Load OAuth desktop client values
```sh
export CLIENT_JSON=/absolute/path/to/client_secret_<id>.apps.googleusercontent.com.json
export GMAIL_OAUTH_CLIENT_ID=$(python3 - <<'PY'
import json, os
print(json.load(open(os.environ["CLIENT_JSON"]))["installed"]["client_id"])
PY
)
export GMAIL_OAUTH_CLIENT_SECRET=$(python3 - <<'PY'
import json, os
print(json.load(open(os.environ["CLIENT_JSON"]))["installed"]["client_secret"])
PY
)
```

## 1a) (Optional) Read the currently-deployed values from Fly

If you don't have the client secret file locally, you can read the live values from a started Fly machine:

```sh
# Start a machine if both are stopped
fly machine start <id> -a eldaa
fly ssh console -a eldaa -C 'sh -c "printenv | grep -E GMAIL"'
```

`fly secrets list` only shows truncated digests, not values — `fly ssh console` on a started machine is the only CLI way to get the actual env.

## 2) Generate consent URL and authorize `no-reply@eldaa.org.nz`
```sh
python3 - <<'PY'
import os, urllib.parse
params = {
  "client_id": os.environ["GMAIL_OAUTH_CLIENT_ID"],
  "redirect_uri": "http://localhost",
  "response_type": "code",
  "scope": "https://www.googleapis.com/auth/gmail.send",
  "access_type": "offline",
  "prompt": "consent",
  "include_granted_scopes": "true",
}
print("https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params))
PY
```
Do not add `https://www.googleapis.com/auth/cloud-platform` unless you truly need Google Cloud APIs in this same token. That scope makes the token subject to Google Cloud session-control reauth and can cause recurring `invalid_rapt` failures.
Open the printed URL, sign in as `no-reply@eldaa.org.nz`, approve access, and copy the full callback URL (`http://localhost/?code=...`).

## 3) Exchange auth code for refresh token
```sh
export CALLBACK_URL='http://localhost/?code=<paste_full_callback_url_here>'
export AUTH_CODE=$(python3 - <<'PY'
import os, urllib.parse
print(urllib.parse.parse_qs(urllib.parse.urlparse(os.environ["CALLBACK_URL"]).query)["code"][0])
PY
)
export TOKEN_JSON=$(curl -sS -X POST https://oauth2.googleapis.com/token \
  -d client_id="$GMAIL_OAUTH_CLIENT_ID" \
  -d client_secret="$GMAIL_OAUTH_CLIENT_SECRET" \
  -d code="$AUTH_CODE" \
  -d grant_type=authorization_code \
  -d redirect_uri=http://localhost)
export GMAIL_OAUTH_REFRESH_TOKEN=$(printf '%s' "$TOKEN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['refresh_token'])")
```

## 4) Roll out to staging
```sh
fly secrets set -a eldaa \
  GMAIL_OAUTH_CLIENT_ID="$GMAIL_OAUTH_CLIENT_ID" \
  GMAIL_OAUTH_CLIENT_SECRET="$GMAIL_OAUTH_CLIENT_SECRET" \
  GMAIL_OAUTH_REFRESH_TOKEN="$GMAIL_OAUTH_REFRESH_TOKEN" \
  GMAIL_SENDER_EMAIL=no-reply@eldaa.org.nz
```

## 5) Verify staging
```sh
fly secrets list -a eldaa | grep GMAIL_
fly logs -a eldaa --no-tail | grep -E "resume_email_(sent|failed)|Precondition check failed"
curl -sS https://eldaa.fly.dev/api/health | python3 -m json.tool
# expect: {"status":"ok","stripe":"connected","gmail":"connected"}
```
Then run one `/professional/apply` test:
- URL includes `?token=...`
- Resume email arrives
- Sender is `no-reply@eldaa.org.nz`

## 6) Promote to production
```sh
fly secrets set -a eldaa-production \
  GMAIL_OAUTH_CLIENT_ID="$GMAIL_OAUTH_CLIENT_ID" \
  GMAIL_OAUTH_CLIENT_SECRET="$GMAIL_OAUTH_CLIENT_SECRET" \
  GMAIL_OAUTH_REFRESH_TOKEN="$GMAIL_OAUTH_REFRESH_TOKEN" \
  GMAIL_SENDER_EMAIL=no-reply@eldaa.org.nz
fly secrets list -a eldaa-production | grep GMAIL_
fly logs -a eldaa-production --no-tail | grep -E "resume_email_(sent|failed)|Precondition check failed"
curl -sS https://subscribe.eldaa.org.nz/api/health | python3 -m json.tool
# expect: {"status":"ok","stripe":"connected","gmail":"connected"}
```

## 7) Cleanup local shell secrets
```sh
unset CALLBACK_URL AUTH_CODE TOKEN_JSON GMAIL_OAUTH_REFRESH_TOKEN GMAIL_OAUTH_CLIENT_ID GMAIL_OAUTH_CLIENT_SECRET CLIENT_JSON
```
