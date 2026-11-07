#!/usr/bin/env bash
# One command from raw inputs to checked datasets. Deterministic: the same inputs give the same
# MANIFEST.json files (the workflow runs it twice and compares them).
# Usage: scripts/hf/build.sh OUT_DIR [DATASET|all]
# Optional inputs through env: SIM_DIR, TRACE_DIR, ASSURANCE_FILE (see build-datasets.mjs).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:?usage: build.sh OUT_DIR [DATASET|all]}"
dataset="${2:-all}"
rm -rf "$out"
node "$here/build-datasets.mjs" --out "$out" --dataset "$dataset" \
  ${SIM_DIR:+--sim-dir "$SIM_DIR"} ${TRACE_DIR:+--trace-dir "$TRACE_DIR"} ${ASSURANCE_FILE:+--assurance "$ASSURANCE_FILE"}
python3 "$here/to-parquet.py" "$out"
node "$here/validate-datasets.mjs" "$out"
node "$here/finalize.mjs" "$out"
for d in "$out"/*/; do (cd "$d" && python3 verify.py >/dev/null); done
node "$here/scan-outputs.mjs" "$out"
