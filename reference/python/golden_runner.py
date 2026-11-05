"""Run the shared golden fixtures against engine.py.

Usage: python golden_runner.py fixtures/golden [more dirs or files]

Ops: register, bid, tick, hammer, promote, revoke, abort, pause, resume, extend (`amount` of an
extend step is the added time in ms). `complete` is not supported by engine.py.

Fixtures are JSON files with integer-millisecond times (see
packages/engine/fixtures/golden/SCHEMA.json). Times are converted to exact
seconds (Fraction) before they reach the engine, so boundary milliseconds
are compared without floating point error. Only fixtures with
`"parity": true` are run; others are listed as skipped.
"""
from __future__ import annotations

import json
import sys
from fractions import Fraction
from pathlib import Path

from engine import Auction, Rejected

CONFIG_KEYS = {
    "reserve": ("reserve", False),
    "minIncrement": ("min_increment", False),
    "endTs": ("end_ts", True),
    "softCloseWindow": ("soft_close_window", True),
    "softCloseExtension": ("soft_close_extension", True),
    "maxExtensions": ("max_extensions", False),
}


def secs(ms: int) -> Fraction:
    return Fraction(ms, 1000)


def load(path: Path) -> list[tuple[str, dict]]:
    """Return (file name, fixture) pairs for a file or a directory of *.json."""
    files = [path] if path.is_file() else sorted(path.glob("*.json"))
    out = []
    for f in files:
        if f.name == "SCHEMA.json":
            continue
        try:
            fx = json.loads(f.read_text())
        except json.JSONDecodeError as e:
            raise SystemExit(f"{f.name}: invalid JSON: {e}")
        for key in ("name", "parity", "config", "steps", "expect"):
            if key not in fx:
                raise SystemExit(f"{f.name}: missing field {key}")
        out.append((f.name, fx))
    return out


def run_fixture(fx: dict) -> dict:
    """Play one fixture; return the observed result in the shape of `expect`."""
    cfg = fx["config"]
    kwargs = {}
    for src, (dst, is_time) in CONFIG_KEYS.items():
        if src in cfg:
            kwargs[dst] = secs(cfg[src]) if is_time else cfg[src]
    a = Auction(fx["name"], cfg["mode"], **kwargs)
    rejects: list[str] = []
    for i, st in enumerate(fx["steps"]):
        op, at = st["op"], secs(st["at"])
        try:
            if op == "register":
                a.register(st["bidder"], st["ceiling"])
            elif op == "bid":
                a.place_bid(st["bidder"], st["amount"], at)
            elif op == "tick":
                a.tick(at)
            elif op == "hammer":
                a.hammer(at)
            elif op == "promote":
                a.promote(st["bidder"])
            elif op == "revoke":
                a.revoke(st["bidder"])
            elif op == "abort":
                a.abort()
            elif op == "pause":
                a.pause(at)
            elif op == "resume":
                a.resume(at)
            elif op == "extend":
                a.extend(at, secs(st["amount"]))  # `amount` is the added time in ms
            elif op == "complete":
                a.complete()
            else:
                raise SystemExit(f"{fx['name']}: step {i}: op {op} is not supported by engine.py")
        except Rejected as r:
            rejects.append(r.code)
    outcome = a.outcome  # the current result: hammer, promotion, unsold or abort
    res: dict = {
        "winner": outcome.winner if outcome else None,
        "price": outcome.price if outcome else 0,
        "ranking": [[b, amt] for b, amt in a.ranking()],
        "rejects": rejects,
        "endsAt": int(a.end_ts * 1000),
    }
    return res


def diff(expect: dict, got: dict) -> list[str]:
    lines = []
    for key, want in expect.items():
        if got.get(key) != want:
            lines.append(f"  {key}: expected {want!r}, got {got.get(key)!r}")
    return lines


def run_paths(paths: list[Path]) -> tuple[int, int, list[str]]:
    ran = skipped = 0
    failures: list[str] = []
    for p in paths:
        for fname, fx in load(p):
            if not fx["parity"]:
                skipped += 1
                continue
            ran += 1
            d = diff(fx["expect"], run_fixture(fx))
            if d:
                failures.append(f"{fname} ({fx['name']})\n" + "\n".join(d))
    return ran, skipped, failures


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    ran, skipped, failures = run_paths([Path(a) for a in argv])
    for f in failures:
        print("FAIL", f)
    print(f"{ran} parity fixtures run, {skipped} skipped, {len(failures)} failed")
    return 1 if failures or ran == 0 else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
