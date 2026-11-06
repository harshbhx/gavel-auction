#!/usr/bin/env bash
# Polls GET <base>/version until the served sha starts with the expected commit id.
# Usage: wait-version.sh <base-url> <expected-sha> [timeout-seconds]
# Exit 0 when it matches, 1 when the timeout passes with another sha (or none) served.
set -u
base="${1:?base url}"
want="${2:?expected sha}"
limit="${3:-900}"
case "$want" in
  *[!0-9a-fA-F]* | '') echo "expected sha must be a hex commit id" >&2; exit 2 ;;
esac
end=$((SECONDS + limit))
sha=""
while [ "$SECONDS" -lt "$end" ]; do
  sha="$(curl -sS --max-time 15 "${base%/}/version" 2>/dev/null | jq -r '.sha // empty' 2>/dev/null || true)"
  case "$sha" in
    '') ;;
    "$want"*) echo "version ok: $sha"; exit 0 ;;
  esac
  sleep 10
done
echo "version mismatch: served '${sha:-unknown}', expected '$want'" >&2
exit 1
