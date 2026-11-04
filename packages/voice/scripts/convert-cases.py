#!/usr/bin/env python3
"""One-time conversion of reference/python/parser_cases.py (CASES and HELDOUT) to cases.json.

Usage: python3 scripts/convert-cases.py [out.json]
Amounts become integer cents. The held-out entry the Python prototype gets wrong is
kept, flagged with knownDivergence, never deleted.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "reference" / "python"))

from parser_cases import CASES, HELDOUT  # noqa: E402

KNOWN_DIVERGENCE = {
    "I raise to eight hundred": (
        "Python reads 'to' after a raising verb as ambiguous and returns confirm; "
        "the label is the intended bid. Recorded, not deleted (R-VOX-036)."
    ),
}


def expected(exp):
    if exp[0] == "bid":
        return {"status": "bid", "bidder": str(exp[1]), "amountCents": int(exp[2]) * 100}
    return {"status": exp[0]}


def convert(rows, which, counters):
    out = []
    for category, text, speaker, price, exp in rows:
        counters[category] = counters.get(category, 0) + 1
        entry = {
            "id": f"{category}-{counters[category]:03d}",
            "set": which,
            "category": category,
            "text": text,
            "speaker": speaker,
            "currentPriceCents": None if price is None else int(price) * 100,
            "expected": expected(exp),
        }
        if text in KNOWN_DIVERGENCE and which == "heldout":
            entry["knownDivergence"] = KNOWN_DIVERGENCE[text]
        out.append(entry)
    return out


def main():
    counters = {}
    cases = convert(CASES, "dev", counters) + convert(HELDOUT, "heldout", counters)
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "packages/voice/fixtures/text/cases.json"
    target.write_text(json.dumps(cases, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(cases)} cases to {target}")


if __name__ == "__main__":
    main()
