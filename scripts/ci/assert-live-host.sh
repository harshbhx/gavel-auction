#!/usr/bin/env bash
# Refuse any live-traffic target that is not one of our own hosts.
# Usage: assert-live-host.sh <name>=<url> [<name>=<url> ...]
# Exact match on the whole origin (one optional trailing slash). No path, port,
# user name or password, so look-alikes and userinfo tricks never match.
set -u

if [ "$#" -eq 0 ]; then
  echo "::error title=Bad input::assert-live-host.sh needs at least one name=url pair" >&2
  exit 2
fi

for pair in "$@"; do
  name="${pair%%=*}"
  value="${pair#*=}"
  origin="${value%/}"
  case "$origin" in
    https://gavel.dualmindlab.tech | \
    https://api.gavel.dualmindlab.tech | \
    https://docs.gavel.dualmindlab.tech | \
    https://gavel-web.creharsh.workers.dev | \
    https://gavel-web-preview.creharsh.workers.dev | \
    https://gavel-docs.creharsh.workers.dev | \
    https://gavel-auction-z2nm.onrender.com) ;;
    *)
      echo "::error title=Host not allowed::$name must be one of the GAVEL hosts (https origin, no path, port, user name or password); refusing '$value'" >&2
      exit 2
      ;;
  esac
done
