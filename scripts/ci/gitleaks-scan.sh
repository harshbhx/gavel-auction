#!/usr/bin/env bash
# Installs a pinned gitleaks and scans a commit range with the repository config.
#
# Why this exists: the gitleaks-action downloads the release in one attempt and fails the whole
# `secrets` job on a transient 5xx from GitHub's release CDN. Here the download is retried, the
# tarball is verified against scripts/ci/gitleaks-checksums.txt (taken from the release's own
# checksums file), and if the release host stays unreachable the same version is run from the
# ghcr.io image, pinned by digest. The scan itself is as strict as the action's: any finding
# fails the job.
#
# Usage: scripts/ci/gitleaks-scan.sh <log-opts>
#   <log-opts> is passed to `git log`, for example "BASE^..HEAD". Empty scans all history.
# Test mode: scripts/ci/gitleaks-scan.sh --control
#   Proves the scanner and config detect a planted fake secret (see control()).
set -euo pipefail

VERSION="8.16.1"
TARBALL="gitleaks_${VERSION}_linux_x64.tar.gz"
URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${TARBALL}"
# Index digest of ghcr.io/gitleaks/gitleaks:v8.16.1 (multi-arch), used only as a fallback.
IMAGE="ghcr.io/gitleaks/gitleaks@sha256:723399e184f90831c6e69bcd1404bca0ee383e45a6f7c3f94e8d78520a350f4c"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="${GITLEAKS_CONFIG:-$ROOT/.gitleaks.toml}"
# docker needs absolute paths; a relative name would be read as a volume name.
case "$CONFIG" in /*) ;; *) CONFIG="$PWD/$CONFIG" ;; esac
# Verified tarballs are kept here so an actions/cache step can restore them on later runs.
CACHE_DIR="${GITLEAKS_CACHE_DIR:-}"
# GITLEAKS_FORCE_DOCKER=1 skips the release and the cache so CI can prove the container path.
FORCE_DOCKER="${GITLEAKS_FORCE_DOCKER:-0}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

GITLEAKS=""
USE_DOCKER=0

verify_tarball() {
  (cd "$(dirname "$1")" && grep " $TARBALL\$" "$ROOT/scripts/ci/gitleaks-checksums.txt" | sha256sum --check --strict -)
}

unpack() {
  mkdir "$WORK/bin"
  tar -xzf "$1" -C "$WORK/bin" gitleaks
  GITLEAKS="$WORK/bin/gitleaks"
}

install_from_cache() {
  [ -n "$CACHE_DIR" ] && [ -f "$CACHE_DIR/$TARBALL" ] || return 1
  verify_tarball "$CACHE_DIR/$TARBALL" || { echo "cached tarball failed its sha256 check; ignoring it" >&2; return 1; }
  unpack "$CACHE_DIR/$TARBALL"
}

install_from_release() {
  curl --fail --silent --show-error --location \
    --retry 6 --retry-all-errors --retry-delay 10 --connect-timeout 20 --max-time 120 \
    --output "$WORK/$TARBALL" "$URL" || return 1
  verify_tarball "$WORK/$TARBALL" || {
    echo "gitleaks tarball failed its sha256 check; refusing to use it" >&2
    exit 1
  }
  if [ -n "$CACHE_DIR" ]; then
    mkdir -p "$CACHE_DIR" && cp "$WORK/$TARBALL" "$CACHE_DIR/$TARBALL"
  fi
  unpack "$WORK/$TARBALL"
}

install() {
  if [ "$FORCE_DOCKER" != 1 ]; then
    if install_from_cache; then
      echo "gitleaks ${VERSION} installed from the cached tarball (sha256 verified)"
      return
    fi
    if install_from_release; then
      echo "gitleaks ${VERSION} installed from the GitHub release (sha256 verified)"
      return
    fi
    echo "Release download failed after retries; falling back to the pinned container image" >&2
  else
    echo "GITLEAKS_FORCE_DOCKER=1: using the pinned container image" >&2
  fi
  local attempt
  for attempt in 1 2 3 4; do
    if docker pull --quiet "$IMAGE" >/dev/null; then
      USE_DOCKER=1
      echo "gitleaks ${VERSION} will run from ${IMAGE}"
      return
    fi
    sleep $((attempt * 10))
  done
  echo "Could not obtain gitleaks from the release or the image" >&2
  exit 1
}

# run_gitleaks <repo-dir> <config> <extra args...>
run_gitleaks() {
  local repo="$1" config="$2"
  shift 2
  if [ "$USE_DOCKER" = 1 ]; then
    # The repository is mounted at /repo and the config's directory at /cfg, both by absolute path.
    docker run --rm -w /repo \
      -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
      -v "$repo":/repo -v "$(dirname "$config")":/cfg:ro "$IMAGE" \
      detect --source /repo --config "/cfg/$(basename "$config")" "$@"
  else
    "$GITLEAKS" detect --source "$repo" --config "$config" "$@"
  fi
}

scan() {
  local opts="$1" args=(--redact --verbose --no-banner --exit-code 2)
  if [ -n "$opts" ]; then
    args+=(--log-opts "$opts")
  fi
  run_gitleaks "$ROOT" "$CONFIG" "${args[@]}"
}

# Negative control: a throwaway repository holding fake secrets (assembled at run time, so this
# file never contains them) must be reported with exit code 2, once for a default rule and once
# for the project rule. A clean commit must pass.
control() {
  local repo="$WORK/control"
  mkdir "$repo"
  git -C "$repo" init --quiet
  git -C "$repo" config user.email control@example.invalid
  git -C "$repo" config user.name control
  printf 'clean\n' >"$repo/ok.txt"
  git -C "$repo" add ok.txt
  git -C "$repo" commit --quiet -m clean
  local clean_rc=0
  run_gitleaks "$repo" "$CONFIG" --redact --no-banner --exit-code 2 >/dev/null 2>&1 || clean_rc=$?
  [ "$clean_rc" = 0 ] || { echo "control: clean repository was flagged (exit $clean_rc)" >&2; exit 1; }
  local pat="ghp_""$(printf 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5')"
  printf 'token = "%s"\n' "$pat" >"$repo/leak-default.txt"
  printf '%s=%s\n' "GROQ_API""_KEY" 'qwertyuiop1234567890' >"$repo/leak-project.txt"
  git -C "$repo" add .
  git -C "$repo" commit --quiet -m planted
  local rc=0
  run_gitleaks "$repo" "$CONFIG" --redact --no-banner --exit-code 2 >/dev/null 2>&1 || rc=$?
  [ "$rc" = 2 ] || { echo "control: planted secrets were NOT detected (exit $rc)" >&2; exit 1; }
  echo "control: planted fake secrets detected as expected (exit 2)"
}

install
if [ "${1:-}" = "--control" ]; then
  control
else
  scan "${1:-}"
fi
