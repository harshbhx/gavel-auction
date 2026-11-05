#!/usr/bin/env bash
# Post-deploy smoke for the API host (R-QA-042, R-QA-044, T-QA-083).
# Usage: scripts/smoke.sh <base-url>
# Optional env: ADMIN_KEY (enables the create-auction check), SMOKE_TIMEOUT (seconds, default 15),
#               SMOKE_RETRIES (health attempts, default 12, 5 s apart; a cold host needs time).
# Exits non-zero on the first failed check. No secret value is ever printed.
set -u

base="${1:-}"
if [ -z "$base" ]; then
  echo "usage: scripts/smoke.sh <base-url>" >&2
  exit 2
fi
base="${base%/}"
timeout_s="${SMOKE_TIMEOUT:-15}"
retries="${SMOKE_RETRIES:-12}"

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# status <method> <path> [curl args...]: prints the HTTP status, or 000 when curl itself failed.
status() {
  local method="$1" path="$2"
  shift 2
  curl -sS -o /dev/null -w '%{http_code}' --max-time "$timeout_s" -X "$method" "$@" "$base$path" 2>/dev/null || true
}

# 1. /healthz must answer 200 (the host may be waking from sleep, so retry).
code="000"
attempt=1
while [ "$attempt" -le "$retries" ]; do
  code="$(status GET /healthz)"
  [ "$code" = "200" ] && break
  echo "healthz attempt $attempt of $retries: $code"
  attempt=$((attempt + 1))
  sleep 5
done
[ "$code" = "200" ] || fail "GET /healthz answered $code, want 200"
echo "ok   GET /healthz 200"

# 2. /warmup: 200 when warm. 404 means the route is not registered in this build yet.
code="$(status GET /warmup)"
case "$code" in
  200) echo "ok   GET /warmup 200" ;;
  404) echo "skip GET /warmup 404 (route not registered in this build)" ;;
  *) fail "GET /warmup answered $code, want 200" ;;
esac

# 3. An unsigned webhook must be refused with 400.
code="$(status POST /webhooks/paypal -H 'content-type: application/json' --data '{}')"
[ "$code" = "400" ] || fail "unsigned POST /webhooks/paypal answered $code, want 400"
echo "ok   POST /webhooks/paypal unsigned 400"

# 4. Create-auction route: refused without the admin key, created with it. A build that does
# not mount the auction routes (main.ts has no extraRoutes yet, #722) answers 404: skip.
code="$(status POST /api/auctions -H 'content-type: application/json' --data '{}')"
if [ "$code" = "404" ]; then
  echo "skip POST /api/auctions 404 (route not registered in this build)"
  echo "smoke passed for $base"
  exit 0
fi
[ "$code" = "401" ] || fail "POST /api/auctions without a key answered $code, want 401"
echo "ok   POST /api/auctions without key 401"

if [ -z "${ADMIN_KEY:-}" ]; then
  echo "skip POST /api/auctions with key (ADMIN_KEY not set)"
else
  end_ts=$(( ($(date +%s) + 3600) * 1000 ))
  body="{\"title\":\"smoke\",\"config\":{\"mode\":\"english\",\"currency\":\"USD\",\"reserve\":10000,\"minIncrement\":500,\"endTs\":$end_ts,\"softCloseWindowMs\":30000,\"softCloseExtensionMs\":30000,\"maxExtensions\":5,\"ceilingPresets\":[30000,50000],\"confirmConfidenceThreshold\":0.85}}"
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$timeout_s" -X POST \
    -H 'content-type: application/json' -H "x-admin-key: $ADMIN_KEY" \
    --data "$body" "$base/api/auctions" 2>/dev/null || true)"
  [ "$code" = "201" ] || fail "POST /api/auctions with key answered $code, want 201"
  echo "ok   POST /api/auctions with key 201"
fi

echo "smoke passed for $base"
