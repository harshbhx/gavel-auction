"""R-ENG-114: the scenario exporter is deterministic and covers the operator commands (D-0030)."""
import json
import random

from scenario_export import scenario


def make(seed: int, n: int) -> list[dict]:
    rng = random.Random(seed)
    return [scenario(rng, i, seed) for i in range(n)]


def test_same_seed_same_scenarios():
    assert make(20261104, 50) == make(20261104, 50)
    assert json.dumps(make(1, 20)) != json.dumps(make(2, 20))


def test_every_operator_command_is_generated():
    ops = {st["op"] for sc in make(20261104, 400) for st in sc["steps"]}
    assert {"promote", "revoke", "abort", "pause", "resume", "extend"} <= ops


def test_step_times_never_decrease():
    for sc in make(20261104, 400):
        ats = [st["at"] for st in sc["steps"]]
        assert ats == sorted(ats), sc["id"]


def test_promotions_and_refusals_are_reached():
    out = make(20261104, 600)
    codes = {c for sc in out for c in sc["outcome"]["rejects"]}
    assert {"cannot_promote", "lot_done", "lot_frozen", "cannot_hammer", "ceiling_revoked"} <= codes
    assert any(
        any(st["op"] == "promote" for st in sc["steps"]) and sc["outcome"]["winner"] is not None
        for sc in out
    )
