"""Seeded random scenario exporter for differential testing against the TypeScript engine.

    python scenario_export.py --seed 20261104 --n 2000 > out.jsonl

Writes one JSON object per line: {"id", "config", "steps", "outcome"}. `config` and `steps`
use the golden fixture format; `outcome` is what this reference engine observes, in the shape of
a fixture `expect`. Only parity-safe features are generated: flat increments, integer cents,
non-decreasing step times, ops register / bid / tick / hammer.
"""
from __future__ import annotations

import argparse
import json
import random
import sys

from golden_runner import run_fixture

CEILING = 100_000


def scenario(rng: random.Random, index: int) -> dict:
    mode = rng.choice(["english", "proxy", "second_price"])
    reserve = rng.choice([1, 500, 1000, 2500])
    inc = rng.choice([1, 50, 100, 250])
    end = rng.choice([20_000, 60_000, 100_000])
    config: dict = {"mode": mode, "reserve": reserve, "minIncrement": inc, "endTs": end}
    if mode != "second_price" and rng.random() < 0.4:
        config["softCloseWindow"] = rng.choice([5_000, 10_000])
        config["softCloseExtension"] = rng.choice([5_000, 15_000])
        config["maxExtensions"] = rng.choice([1, 2, 5])
    bidders = [f"b{i}" for i in range(rng.randint(1, 5))]
    steps: list[dict] = []
    for b in bidders:
        ceiling = rng.choice([CEILING, CEILING, 3000, 800])
        steps.append({"op": "register", "at": 0, "bidder": b, "ceiling": ceiling})
    if rng.random() < 0.1:
        bidders.append("ghost")  # never registered: exercises the unregistered rejection
    times = sorted(rng.randint(1, end + 20_000) for _ in range(rng.randint(0, 14)))
    for at in times:
        if rng.random() < 0.1:
            steps.append({"op": "tick", "at": at})
            continue
        base = rng.choice([reserve, reserve + inc, rng.randint(1, 6000)])
        steps.append(
            {"op": "bid", "at": at, "bidder": rng.choice(bidders), "amount": base + rng.randint(0, 8) * inc}
        )
    steps.append({"op": "hammer", "at": max([end] + times) + 1})
    fx = {"name": f"scenario-{index}", "parity": True, "config": config, "steps": steps}
    return {"id": index, "config": config, "steps": steps, "outcome": run_fixture(fx)}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--n", type=int, required=True)
    args = ap.parse_args(argv)
    rng = random.Random(args.seed)
    for i in range(args.n):
        sys.stdout.write(json.dumps(scenario(rng, i), separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
