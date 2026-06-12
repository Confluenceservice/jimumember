#!/usr/bin/env bash
# Gmail OAuth rotation — step 1: load client creds + print consent URL.
set -euo pipefail

CLIENT_JSON="/Users/thomasb/Downloads/client_secret_531470041058-do9qba7t3c2osmrrri5i0dlhe9nk819u.apps.googleusercontent.com.json"

if [ ! -f "$CLIENT_JSON" ]; then
  echo "ERROR: client JSON not found at $CLIENT_JSON" >&2
  exit 1
fi

# Load client_id + client_secret via python (handles JSON parsing cleanly).
eval "$(python3 - "$CLIENT_JSON" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))["installed"]
print(f'export GMAIL_OAUTH_CLIENT_ID="{d["client_id"]}"')
print(f'export GMAIL_OAUTH_CLIENT_SECRET="{d["client_secret"]}"')
PY
)"

echo "Loaded GMAIL_OAUTH_CLIENT_ID=$GMAIL_OAUTH_CLIENT_ID"

# Persist to a file so step 2 can source it (the `!` shell is ephemeral).
ENV_OUT="/Users/thomasb/eldaa/.run/gmail-oauth-env.sh"
cat > "$ENV_OUT" <<EOF
export GMAIL_OAUTH_CLIENT_ID="$GMAIL_OAUTH_CLIENT_ID"
export GMAIL_OAUTH_CLIENT_SECRET="$GMAIL_OAUTH_CLIENT_SECRET"
EOF
chmod 600 "$ENV_OUT"
echo "Saved env to $ENV_OUT (mode 600)"

# Build + print the consent URL.
CONSENT_URL=$(python3 - "$GMAIL_OAUTH_CLIENT_ID" <<'PY'
import sys, urllib.parse
params = {
    "client_id": sys.argv[1],
    "redirect_uri": "http://localhost",
    "response_type": "code",
    # Request only the scope used by this app. Including cloud-platform can
    # trigger Workspace reauthentication policies (invalid_rapt every ~24h).
    "scope": "https://www.googleapis.com/auth/gmail.send",
    "access_type": "offline",
    "prompt": "consent",
    "include_granted_scopes": "true",
}
print("https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params))
PY
)

echo
echo "================================================================"
echo "CONSENT URL (open this in your browser, signed in as no-reply@eldaa.org.nz):"
echo "$CONSENT_URL"
echo "================================================================"
echo
echo "After approving, the browser will redirect to http://localhost/?code=...&scope=..."
echo "The page will fail to load (no server on localhost) — that's expected."
echo "Copy the FULL URL from the browser address bar."
echo
echo "NEXT: paste it into this command:"
echo "  ! bash /Users/thomasb/eldaa/.run/gmail-oauth-step2.sh"
