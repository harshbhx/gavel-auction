#!/usr/bin/env python3
"""Recomputes the sha256 of every file listed in MANIFEST.json and fails on any difference.

Usage: python verify.py            (run inside the dataset folder)
No third-party packages. Exit code 0 means every file matches.

To check where the data came from: MANIFEST.json holds the commit of the repository the dataset
was built from and the GitHub Actions run that built it. Open the run, then compare the
`hf-datasets` artifact (it carries the same MANIFEST.json). Rows that carry a run URL
(gavel-latency, gavel-gates) can be checked on GitHub the same way.
"""
import hashlib
import json
import sys
from pathlib import Path


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    root = Path(__file__).resolve().parent
    manifest = json.loads((root / "MANIFEST.json").read_text(encoding="utf-8"))
    bad = 0
    for entry in manifest["files"]:
        p = root / entry["path"]
        if not p.is_file():
            print(f"MISSING  {entry['path']}")
            bad += 1
        elif p.stat().st_size != entry["bytes"] or sha256(p) != entry["sha256"]:
            print(f"CHANGED  {entry['path']}")
            bad += 1
    listed = {e["path"] for e in manifest["files"]} | {"MANIFEST.json"}
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).as_posix()
        if p.is_file() and rel not in listed and "__pycache__" not in rel:
            print(f"UNLISTED {rel}")
            bad += 1
    print(f"dataset {manifest['dataset']}, built from commit {manifest['commit']}")
    print(f"build run: {manifest['build_run_url'] or 'not built in CI'}")
    print(f"{len(manifest['files'])} files checked, {bad} problem(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
