#!/usr/bin/env python3
"""Writes a .parquet next to every .jsonl of the dataset folders and records the row counts.

Usage: to-parquet.py OUT_DIR
Needs: pyarrow. The audio metadata file is skipped (the Hugging Face audio loader reads the jsonl).
"""
import json
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq


def main(out: Path) -> int:
    counts = {}
    for jsonl in sorted(out.rglob("*.jsonl")):
        if jsonl.name == "metadata.jsonl":
            continue
        rows = [json.loads(line) for line in jsonl.read_text(encoding="utf-8").splitlines() if line.strip()]
        if not rows:
            continue
        columns = list(dict.fromkeys(k for r in rows for k in r))
        table = pa.table({c: [r.get(c) for r in rows] for c in columns})
        target = jsonl.with_suffix(".parquet")
        pq.write_table(table, target, compression="zstd")
        # read it back: the file must open and hold the same number of rows
        if pq.read_table(target).num_rows != len(rows):
            print(f"row count mismatch in {target}", file=sys.stderr)
            return 1
        counts[str(target.relative_to(out))] = len(rows)
    (out / "parquet-rows.json").write_text(json.dumps(counts, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(counts)} parquet files")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(Path(sys.argv[1])))
