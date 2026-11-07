#!/usr/bin/env python3
"""Uploads the built dataset folders to Hugging Face. Called only by the hf-datasets workflow.

Usage: push.py OUT_DIR
Reads HF_TOKEN and HF_NAMESPACE from the environment. The token is passed to the client and is never
printed. Every dataset folder with a MANIFEST.json is created (public, exist_ok) and uploaded.
"""
import os
import sys
from pathlib import Path

from huggingface_hub import HfApi


def main(out: Path) -> int:
    token = os.environ.get("HF_TOKEN", "")
    namespace = os.environ.get("HF_NAMESPACE", "")
    if not token or not namespace:
        print("HF_TOKEN or HF_NAMESPACE is missing; nothing uploaded")
        return 0
    api = HfApi(token=token)
    for folder in sorted(p for p in out.iterdir() if (p / "MANIFEST.json").is_file()):
        repo_id = f"{namespace}/{folder.name}"
        api.create_repo(repo_id=repo_id, repo_type="dataset", exist_ok=True, private=False)
        api.upload_folder(
            repo_id=repo_id,
            repo_type="dataset",
            folder_path=str(folder),
            commit_message="Update from the build run recorded in MANIFEST.json",
        )
        print(f"uploaded {repo_id}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(Path(sys.argv[1])))
