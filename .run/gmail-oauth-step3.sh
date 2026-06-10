#!/usr/bin/env bash
# Gmail OAuth rotation — step 3: roll out new secrets to Fly (staging then prod).
set -euo pipefail

ENV_FILE="/Users/thomasb/eldaa/.run/gmail-oauth-env.sh"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run step 1 + step 2 first." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -z "${GMAIL_OAUTH_REFRESH_TOKEN:-}" ]; then
  echo "ERROR: GMAIL_OAUTH_REFRESH_TOKEN not set in $ENV_FILE. Run step 2 first." >&2
  exit 1
fi

SENDER="no-reply@eldaa.org.nz"

roll() {
  local app="$1"
  echo ""
  echo "================================================================"
  echo "Rolling to $app..."
  echo "================================================================"
  fly secrets set -a "$app" \
    "GMAIL_OAUTH_CLIENT_ID=$GMAIL_OAUTH_CLIENT_ID" \
    "GMAIL_OAUTH_CLIENT_SECRET=$GMAIL_OAUTH_CLIENT_SECRET" \
    "GMAIL_OAUTH_REFRESH_TOKEN=$GMAIL_OAUTH_REFRESH_TOKEN" \
    "GMAIL_SENDER_EMAIL=$SENDER"

  echo ""
  echo "Verifying secrets on $app:"
  fly secrets list -a "$app" | grep GMAIL_ || echo "(no GMAIL_ secrets found — check output above)"
}

roll eldaa
roll eldaa-production

echo ""
echo "================================================================"
echo "Done. Tail logs to verify:"
echo "  fly logs -a eldaa --no-tail | grep -E 'resume_email_(sent|failed)'"
echo "  fly logs -a eldaa-production --no-tail | grep -E 'resume_email_(sent|failed)'"
echo "================================================================"
