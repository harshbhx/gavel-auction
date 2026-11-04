#!/usr/bin/env python3
"""Run reference/python/parser.py over every case in cases.json and write parser-golden.json.

Usage:
  python3 scripts/export-golden.py            write the golden file
  python3 scripts/export-golden.py --check    fail when the committed golden differs
Amounts are converted to integer cents. Output is deterministic.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "reference" / "python"))

from parser import parse  # noqa: E402

FIXTURES = ROOT / "packages" / "voice" / "fixtures" / "text"


def cents(v):
    return None if v is None else int(v) * 100


def build():
    cases = json.loads((FIXTURES / "cases.json").read_text(encoding="utf-8"))
    golden = []
    for c in cases:
        price = c["currentPriceCents"]
        p = parse(c["text"], speaker=c["speaker"], current_price=None if price is None else price // 100)
        golden.append(
            {
                "id": c["id"],
                "status": p.status,
                "bidder": p.bidder,
                "amountCents": cents(p.amount),
                "reason": p.reason,
                "candidatesCents": [cents(x) if isinstance(x, int) else x for x in p.candidates],
            }
        )
    return json.dumps(golden, indent=2, ensure_ascii=False) + "\n"


def main():
    text = build()
    target = FIXTURES / "parser-golden.json"
    if "--check" in sys.argv:
        # Compare parsed JSON so prettier reformatting of the committed file is harmless.
        if not target.exists() or json.loads(target.read_text(encoding="utf-8")) != json.loads(text):
            sys.stderr.write("parser-golden.json is out of date; run scripts/export-golden.py and commit it\n")
            sys.exit(1)
        print("parser-golden.json is up to date")
        return
    target.write_text(text, encoding="utf-8")
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
