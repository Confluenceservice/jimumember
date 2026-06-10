#!/usr/bin/env bash
# Gmail OAuth rotation — step 2: paste callback URL, exchange for refresh token.
# Reads the callback URL from a file at $1 (avoids shell-quoting issues with `!`).
set -euo pipefail

ENV_FILE="/Users/thomasb/eldaa/.run/gmail-oauth-env.sh"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run step 1 first." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

CALLBACK_FILE="${1:-}"
if [ -z "$CALLBACK_FILE" ] || [ ! -f "$CALLBACK_FILE" ]; then
  echo "Usage: bash $0 <path-to-file-containing-callback-url>" >&2
  echo "" >&2
  echo "Save the full browser address bar (http://localhost/?code=...) to a file first," >&2
  echo "then re-run this script with the file path." >&2
  echo "" >&2
  echo "Easiest way: copy the URL, then in your terminal run:" >&2
  echo "  pbpaste > /tmp/callback-url.txt" >&2
  echo "  bash $0 /tmp/callback-url.txt" >&2
  exit 1
fi

CALLBACK_URL=$(cat "$CALLBACK_FILE" | tr -d '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
echo "Callback URL (first 80 chars): ${CALLBACK_URL:0:80}..."

# Extract the auth code.
AUTH_CODE=$(python3 - "$CALLBACK_URL" <<'PY'
import sys, urllib.parse
url = sys.argv[1]
codes = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("code", [])
if not codes:
    sys.exit("ERROR: no 'code' parameter found in callback URL. Check you copied the whole URL.")
print(codes[0])
PY
) || { echo "$AUTH_CODE" >&2; exit 1; }

echo "Auth code (first 40 chars): ${AUTH_CODE:0:40}..."

# Exchange code for tokens.
echo "Exchanging code for tokens..."
TOKEN_RESPONSE=$(curl -sS -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$GMAIL_OAUTH_CLIENT_ID" \
  -d "client_secret=$GMAIL_OAUTH_CLIENT_SECRET" \
  -d "code=$AUTH_CODE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=http://localhost")

# Pretty-print the response.
echo "$TOKEN_RESPONSE" | python3 -m json.tool

# Extract and save refresh_token.
REFRESH_TOKEN=$(printf '%s' "$TOKEN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['refresh_token'])" 2>/dev/null || true)

if [ -z "$REFRESH_TOKEN" ]; then
  echo "" >&2
  echo "ERROR: no refresh_token in response." >&2
  echo "If the response has an 'error' field (e.g. 'invalid_grant'), the auth code was" >&2
  echo "already used or expired. Re-do the consent step and try a fresh callback URL." >&2
  exit 1
fi

# Append refresh_token to the env file so step 3 can roll it out.
cat >> "$ENV_FILE" <<EOF
export GMAIL_OAUTH_REFRESH_TOKEN="$REFRESH_TOKEN"
EOF
chmod 600 "$ENV_FILE"
echo ""
echo "================================================================"
echo "REFRESH TOKEN (first 20 chars): ${REFRESH_TOKEN:0:20}..."
echo "Saved to $ENV_FILE (mode 600)"
echo "================================================================"
echo ""
echo "NEXT: roll the new token to Fly:"
echo "  ! bash /Users/thomasb/eldaa/.run/gmail-oauth-step3.sh"
