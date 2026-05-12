# Gmail OAuth token rotation and Fly secret rollout
Use this when resume-link emails fail, sender identity is wrong, or you need to rotate Gmail OAuth credentials.

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

## 2) Generate consent URL and authorize `no-reply@eldaa.org.nz`
```sh
python3 - <<'PY'
import os, urllib.parse
params = {
  "client_id": os.environ["GMAIL_OAUTH_CLIENT_ID"],
  "redirect_uri": "http://localhost",
  "response_type": "code",
  "scope": "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/gmail.send",
  "access_type": "offline",
  "prompt": "consent",
  "include_granted_scopes": "true",
}
print("https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params))
PY
```
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
```

## 7) Cleanup local shell secrets
```sh
unset CALLBACK_URL AUTH_CODE TOKEN_JSON GMAIL_OAUTH_REFRESH_TOKEN GMAIL_OAUTH_CLIENT_ID GMAIL_OAUTH_CLIENT_SECRET CLIENT_JSON
```
