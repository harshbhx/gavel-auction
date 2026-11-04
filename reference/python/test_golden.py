"""R-ENG-113: every parity fixture must give the same result in engine.py."""
from pathlib import Path

import pytest

from golden_runner import diff, load, run_fixture

GOLDEN = Path(__file__).resolve().parents[2] / "packages" / "engine" / "fixtures" / "golden"
CASES = load(GOLDEN)


def test_fixtures_present():
    assert CASES, "no golden fixtures found"


@pytest.mark.parametrize("fname,fx", [c for c in CASES if c[1]["parity"]], ids=lambda v: v if isinstance(v, str) else "")
def test_parity_fixture(fname, fx):
    problems = diff(fx["expect"], run_fixture(fx))
    assert not problems, fname + "\n" + "\n".join(problems)


def test_runner_reports_difference():
    fx = {"name": "x", "parity": True, "config": {"mode": "english", "endTs": 10000}, "steps": [
        {"op": "register", "at": 0, "bidder": "a", "ceiling": 500},
        {"op": "bid", "at": 1000, "bidder": "a", "amount": 100},
        {"op": "hammer", "at": 10000}], "expect": {"price": 101}}
    assert diff(fx["expect"], run_fixture(fx)) == ["  price: expected 101, got 100"]
