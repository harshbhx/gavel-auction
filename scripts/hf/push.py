#!/usr/bin/env python3
"""Publishes the GAVEL evidence to Hugging Face: five datasets, the Space and the collection.

Usage: push.py DATASETS_DIR [SPACE_DIR] [--dry-run]

Reads HF_TOKEN and HF_NAMESPACE from the environment. The token is passed to the client and is never
printed. With --dry-run nothing is contacted and no token is needed: the script prints what a real
run would create and upload, in order.

Real run, in order: every dataset folder with a MANIFEST.json is created (public, exist_ok) and
uploaded in the collection order; the Space `gavel-evidence-explorer` is created (static SDK) and
uploaded; the collection is created (or found by its title) and the datasets and the Space are
added to it in that order. Re-running updates the files and leaves existing collection items alone.
"""
import os
import sys
from pathlib import Path

COLLECTION_TITLE = "GAVEL Evidence: auction holds, hammer and receipts"
# The Hub limits a collection description to 150 characters.
COLLECTION_DESCRIPTION = (
    "Open data behind GAVEL, a hold-then-capture auction: sandbox latency, gates, "
    "a simulated 30-day run, synthetic speech and scripted audit trails."
)
DATASET_ORDER = [
    "gavel-gates",
    "gavel-latency",
    "gavel-sim-30d",
    "gavel-stt-bids",
    "gavel-audit-demo",
]
SPACE_NAME = "gavel-evidence-explorer"


def plan(out: Path, space: Path | None) -> list[tuple[str, str, Path]]:
    """(kind, name, folder) in publish order; only folders that exist are included."""
    items = []
    for name in DATASET_ORDER:
        folder = out / name
        if (folder / "MANIFEST.json").is_file():
            items.append(("dataset", name, folder))
    if space is not None and (space / "index.html").is_file():
        items.append(("space", SPACE_NAME, space))
    return items


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    args = [a for a in argv if a != "--dry-run"]
    if not 1 <= len(args) <= 2:
        print(__doc__, file=sys.stderr)
        return 2
    out = Path(args[0])
    space = Path(args[1]) if len(args) == 2 else None
    items = plan(out, space)
    if not items:
        print("nothing to publish: no dataset folder with MANIFEST.json and no Space folder", file=sys.stderr)
        return 1

    namespace = os.environ.get("HF_NAMESPACE", "")
    shown = namespace or "<namespace>"
    if dry:
        print(f"DRY RUN: nothing is sent to Hugging Face. A real run would, as {shown}:")
        for kind, name, folder in items:
            files = sum(1 for p in folder.rglob("*") if p.is_file())
            print(f"  upload {kind} {shown}/{name} ({files} files from {folder.name})")
        print(f"  create or reuse the collection {COLLECTION_TITLE!r} and add, in this order:")
        for kind, name, _ in items:
            print(f"    {kind} {shown}/{name}")
        return 0

    token = os.environ.get("HF_TOKEN", "")
    missing = [n for n, v in (("HF_TOKEN (repository secret)", token), ("HF_NAMESPACE (repository variable)", namespace)) if not v]
    if missing:
        print("cannot publish, missing: " + ", ".join(missing), file=sys.stderr)
        return 1

    from huggingface_hub import HfApi

    api = HfApi(token=token)
    for kind, name, folder in items:
        repo_id = f"{namespace}/{name}"
        if kind == "dataset":
            api.create_repo(repo_id=repo_id, repo_type="dataset", exist_ok=True, private=False)
        else:
            api.create_repo(repo_id=repo_id, repo_type="space", space_sdk="static", exist_ok=True, private=False)
        api.upload_folder(
            repo_id=repo_id,
            repo_type=kind,
            folder_path=str(folder),
            commit_message="Update from the build run recorded in MANIFEST.json"
            if kind == "dataset"
            else "Update the Evidence Explorer from the repository build",
        )
        print(f"uploaded {kind} {repo_id}")

    slug = None
    for c in api.list_collections(owner=namespace):
        if c.title == COLLECTION_TITLE:
            slug = c.slug
            break
    if slug is None:
        slug = api.create_collection(
            title=COLLECTION_TITLE, namespace=namespace, description=COLLECTION_DESCRIPTION, private=False
        ).slug
        print("created the collection")
    else:
        print("reusing the collection")
    for kind, name, _ in items:
        api.add_collection_item(collection_slug=slug, item_id=f"{namespace}/{name}", item_type=kind, exists_ok=True)
        print(f"in collection: {kind} {namespace}/{name}")
    print(f"collection: https://huggingface.co/collections/{slug}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
