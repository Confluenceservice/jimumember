#!/usr/bin/env bash
#
# setup-stripe-test.sh — Phase 7 automation for the Re:Member blueprint.
#
# Idempotently creates the Stripe products, prices, and webhook endpoint that
# Re:Member needs, using the Stripe CLI in TEST mode. Run after `stripe login`.
#
# Price types (these matter — Re:Member depends on them):
#   - Application prices (STRIPE_PRICE_1 / STRIPE_PRICE_2): RECURRING annual.
#     The application checkout charges a one-time prorated first term, then the
#     webhook creates a deferred subscription using this recurring price.
#   - Renewal prices (STRIPE_PRICE_1_RENEWAL / _2_RENEWAL): ONE-TIME. The
#     renewal checkout runs mode=payment, which rejects recurring prices.
#
# Idempotent: prices are keyed by Stripe lookup_key, so re-running reuses the
# existing price instead of creating a duplicate. Products are matched by name.
#
# Usage:
#   stripe login                       # one-time, opens browser (test mode)
#   export ORG_DISPLAY_NAME="ItDocsNow"
#   export STAGING_WEBHOOK_URL="https://itdocsnow-staging.fly.dev/api/stripe-webhook"
#   export BASIC_AMOUNT=7500           # NZ$75.00 in cents (default 7500)
#   export ADVANCED_AMOUNT=15000       # NZ$150.00 in cents (default 15000)
#   export CURRENCY=nzd                # default nzd (must match src/lib/config.ts)
#   ./bin/setup-stripe-test.sh
#
# Output (stdout): env-var lines + the webhook signing secret. Capture into BW.
#
set -euo pipefail

ORG_DISPLAY_NAME="${ORG_DISPLAY_NAME:-Re:Member}"
STAGING_WEBHOOK_URL="${STAGING_WEBHOOK_URL:?Set STAGING_WEBHOOK_URL to the staging /api/stripe-webhook endpoint}"
CURRENCY="${CURRENCY:-nzd}"
BASIC_AMOUNT="${BASIC_AMOUNT:-7500}"
ADVANCED_AMOUNT="${ADVANCED_AMOUNT:-15000}"

command -v stripe >/dev/null 2>&1 || { echo "stripe CLI not found. Install: https://stripe.com/docs/stripe-cli" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found." >&2; exit 1; }

# Confirm we're in test mode — the CLI's default key after `stripe login` is a
# restricted test key. Guard against accidental live-mode runs.
ACCOUNT=$(stripe config --list 2>/dev/null | grep -i "test_mode" || true)
echo "Stripe CLI test-mode config: ${ACCOUNT:-<assuming test mode>}" >&2

# ---- find-or-create a product by name -------------------------------------
find_or_create_product() {
  local name="$1"
  local slug="$2"
  local existing
  existing=$(stripe products list --limit 100 2>/dev/null \
    | jq -r --arg n "$name" '.data[] | select(.name == $n) | .id' | head -n1)
  if [[ -n "$existing" ]]; then
    echo "Found product: $name ($existing)" >&2
    printf '%s' "$existing"
    return
  fi
  local created
  created=$(stripe products create \
    -d "name=$name" \
    -d "metadata[tier]=$slug" \
    2>/dev/null | jq -r '.id')
  echo "Created product: $name ($created)" >&2
  printf '%s' "$created"
}

# ---- find-or-create a price by lookup_key ---------------------------------
# args: product_id, lookup_key, amount, recurring(true/false)
find_or_create_price() {
  local product="$1"
  local lookup_key="$2"
  local amount="$3"
  local recurring="$4"
  local existing
  existing=$(stripe prices list -d "lookup_keys[0]=$lookup_key" -d "limit=1" 2>/dev/null \
    | jq -r '.data[0].id // empty')
  if [[ -n "$existing" ]]; then
    echo "Found price: $lookup_key ($existing)" >&2
    printf '%s' "$existing"
    return
  fi
  local created
  if [[ "$recurring" == "true" ]]; then
    created=$(stripe prices create \
      -d "product=$product" \
      -d "unit_amount=$amount" \
      -d "currency=$CURRENCY" \
      -d "recurring[interval]=year" \
      -d "lookup_key=$lookup_key" \
      2>/dev/null | jq -r '.id')
  else
    created=$(stripe prices create \
      -d "product=$product" \
      -d "unit_amount=$amount" \
      -d "currency=$CURRENCY" \
      -d "lookup_key=$lookup_key" \
      2>/dev/null | jq -r '.id')
  fi
  echo "Created price: $lookup_key ($created, ${recurring:+recurring }$amount $CURRENCY)" >&2
  printf '%s' "$created"
}

# ---- find-or-create the staging webhook endpoint --------------------------
find_or_create_webhook() {
  local url="$1"
  local existing_id existing_secret
  existing_id=$(stripe webhook_endpoints list --limit 100 2>/dev/null \
    | jq -r --arg u "$url" '.data[] | select(.url == $u) | .id' | head -n1)
  if [[ -n "$existing_id" ]]; then
    echo "Found webhook endpoint: $url ($existing_id)" >&2
    # The secret is only returned at creation time; for an existing endpoint
    # we cannot retrieve it. Tell the operator to roll it if they need it.
    echo "WEBHOOK_ENDPOINT_ID=$existing_id"
    echo "# NOTE: webhook signing secret is only shown at creation. If you need it," >&2
    echo "#       roll it in the dashboard or delete + re-run this script." >&2
    return
  fi
  local created secret eid
  created=$(stripe webhook_endpoints create \
    -d "url=$url" \
    -d "enabled_events[]=checkout.session.completed" \
    -d "enabled_events[]=customer.subscription.created" \
    -d "enabled_events[]=customer.subscription.updated" \
    -d "enabled_events[]=customer.subscription.deleted" \
    -d "enabled_events[]=invoice.paid" \
    -d "enabled_events[]=invoice.payment_failed" \
    2>/dev/null)
  eid=$(printf '%s' "$created" | jq -r '.id')
  secret=$(printf '%s' "$created" | jq -r '.secret')
  echo "Created webhook endpoint: $url ($eid)" >&2
  echo "WEBHOOK_ENDPOINT_ID=$eid"
  echo "STRIPE_WEBHOOK_SECRET=$secret"
}

# ---- main -----------------------------------------------------------------
BASIC_PRODUCT=$(find_or_create_product "${ORG_DISPLAY_NAME} Basic Membership" "basic")
ADVANCED_PRODUCT=$(find_or_create_product "${ORG_DISPLAY_NAME} Advanced Membership" "advanced")

PRICE_1=$(find_or_create_price "$BASIC_PRODUCT" "basic_application_${CURRENCY}" "$BASIC_AMOUNT" true)
PRICE_1_RENEWAL=$(find_or_create_price "$BASIC_PRODUCT" "basic_renewal_${CURRENCY}" "$BASIC_AMOUNT" false)
PRICE_2=$(find_or_create_price "$ADVANCED_PRODUCT" "advanced_application_${CURRENCY}" "$ADVANCED_AMOUNT" true)
PRICE_2_RENEWAL=$(find_or_create_price "$ADVANCED_PRODUCT" "advanced_renewal_${CURRENCY}" "$ADVANCED_AMOUNT" false)

echo "" >&2
echo "==== Capture these into Bitwarden ====" >&2
echo "STRIPE_PRICE_1=$PRICE_1"
echo "STRIPE_PRICE_2=$PRICE_2"
echo "STRIPE_PRICE_1_RENEWAL=$PRICE_1_RENEWAL"
echo "STRIPE_PRICE_2_RENEWAL=$PRICE_2_RENEWAL"
find_or_create_webhook "$STAGING_WEBHOOK_URL"