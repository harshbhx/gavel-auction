"""Seeded random scenario exporter for differential testing against the TypeScript engine.

    python scenario_export.py --seed 20261104 --n 2000 > out.jsonl

Writes one JSON object per line: {"id", "config", "steps", "outcome"}. `config` and `steps`
use the golden fixture format; `outcome` is what this reference engine observes, in the shape of
a fixture `expect`. Only parity-safe features are generated: flat increments, integer cents,
non-decreasing step times, ops register / bid / tick / hammer and, in about half of the scenarios
(D-0030), revoke / pause / resume / extend / abort before the hammer and promote / revoke / abort /
pause / bid after it. The extra commands are drawn from a second generator seeded from the seed and
the scenario index, so the base draws of a seed do not change.
"""
from __future__ import annotations

import argparse
import json
import random
import sys

from golden_runner import run_fixture

CEILING = 100_000
EXTRA_SHARE = 0.5  # share of scenarios that carry operator commands


def operator_commands(ext: random.Random, bidders: list, end: int) -> list[dict]:
    """Operator steps placed before the hammer: revoke, pause / resume pairs, extend, abort."""
    out: list[dict] = []
    for _ in range(ext.randint(1, 4)):
        kind = ext.choices(["revoke", "pause", "extend", "resume", "abort"], [4, 4, 3, 1, 1])[0]
        at = ext.randint(1, end + 20_000)
        if kind == "revoke":
            out.append({"op": "revoke", "at": at, "bidder": ext.choice(bidders)})
        elif kind == "pause":
            out.append({"op": "pause", "at": at})
            if ext.random() < 0.8:
                out.append({"op": "resume", "at": at + ext.randint(500, 60_000)})
        elif kind == "extend":
            out.append({"op": "extend", "at": at, "amount": ext.randint(1, 30) * 1000})
        elif kind == "resume":
            out.append({"op": "resume", "at": at})
        elif ext.random() < 0.3:
            out.append({"op": "abort", "at": at})
    return out


def after_hammer(ext: random.Random, config: dict, steps: list, bidders: list, t: int) -> list[dict]:
    """Steps after the hammer: promotions (mostly of the real winner), revokes and refused commands."""
    out: list[dict] = []
    for _ in range(ext.randint(0, 5)):
        t += ext.randint(1, 2000)
        so_far = steps + out
        winner = run_fixture({"name": "x", "parity": True, "config": config, "steps": so_far})["winner"]
        r = ext.random()
        if r < 0.55:
            who = winner if winner is not None and ext.random() < 0.9 else ext.choice(bidders)
            out.append({"op": "promote", "at": t, "bidder": who})
        elif r < 0.7:
            out.append({"op": "revoke", "at": t, "bidder": ext.choice(bidders)})
        elif r < 0.8:
            out.append({"op": "promote", "at": t, "bidder": ext.choice(bidders)})
        elif r < 0.87:
            out.append({"op": "bid", "at": t, "bidder": ext.choice(bidders), "amount": ext.randint(1, 6000)})
        elif r < 0.92:
            out.append({"op": "abort", "at": t})
        elif r < 0.96:
            out.append({"op": "pause", "at": t})
        else:
            out.append({"op": "hammer", "at": t})
    return out


def scenario(rng: random.Random, index: int, seed: int = 0) -> dict:
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
    n_reg = len(steps)
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
    hammer_at = max([end] + times) + 1
    ext = random.Random(f"{seed}:{index}:operator")
    if ext.random() < EXTRA_SHARE:
        extra = operator_commands(ext, bidders, end)
        head, rest = steps[: n_reg], steps[n_reg:]
        steps = head + sorted(rest + extra, key=lambda st: st["at"])  # stable: bids keep their order
        latest = max([end] + [st["at"] for st in steps])
        # Normally hammer after every pause, extension and soft close; sometimes straight after the last step.
        hammer_at = (max(latest, end + 400_000) if ext.random() < 0.8 else latest) + 1
        steps.append({"op": "hammer", "at": hammer_at})
        steps.extend(after_hammer(ext, config, steps, bidders, hammer_at))
    else:
        steps.append({"op": "hammer", "at": hammer_at})
    fx = {"name": f"scenario-{index}", "parity": True, "config": config, "steps": steps}
    return {"id": index, "config": config, "steps": steps, "outcome": run_fixture(fx)}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--n", type=int, required=True)
    args = ap.parse_args(argv)
    rng = random.Random(args.seed)
    for i in range(args.n):
        sys.stdout.write(json.dumps(scenario(rng, i, args.seed), separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
