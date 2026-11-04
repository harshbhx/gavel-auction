"""Settlement saga: capture the winner at the hammer price, void everyone else.
Durable journal (JSON) makes it resumable after a crash at any boundary.
Rules: capture only after a *definite* failure moves to the next candidate (never after an
unknown/timeout outcome); non-winners are voided only after the capture outcome is final.
"""
import json
from fake_paypal import PayPalError, Timeout


class Crash(Exception):
    """Simulated process crash."""


class Pending(Exception):
    """Outcome unknown / transient failure persists; resume later. Nothing unsafe was done."""


class SagaInvariantError(Exception):
    pass


class JournalStore:
    """Stands in for a durable DB row: survives Saga object (process) death."""
    def __init__(self): self.raw = None
    def load(self): return json.loads(self.raw) if self.raw else None
    def save(self, j): self.raw = json.dumps(j, sort_keys=True)


TRANSIENT_STATUS = (429, 500, 502, 503, 504)


class Saga:
    def __init__(self, auction_id, store, paypal, holds, ceilings, ranking, reserve,
                 max_attempts=3, crash_hook=None):
        """holds: bidder->auth_id; ranking: ((bidder, price_if_runner_up), ...) best first,
        first entry's price is the hammer price (list of (bidder, price))."""
        self.aid, self.store, self.pp = auction_id, store, paypal
        self.holds, self.ceilings, self.ranking, self.reserve = holds, ceilings, ranking, reserve
        self.max_attempts = max_attempts
        self.hook = crash_hook or (lambda label: None)

    def _cp(self, label): self.hook(label)

    def _save(self, j, label):
        self.store.save(j)
        self._cp("journaled:" + label)

    # --- retrying call; returns result or raises Pending / PayPalError(definite)
    def _call(self, name, fn):
        last = None
        for _ in range(self.max_attempts):
            self._cp("before:" + name)
            try:
                r = fn()
                self._cp("after:" + name)
                return r
            except Timeout as e:
                last = e
            except PayPalError as e:
                if e.status in TRANSIENT_STATUS: last = e
                else: raise
        raise Pending(f"{name}: {last}")

    def run(self, hammer_price_override=None):
        j = self.store.load()
        if j is None:
            j = {"auction": self.aid, "phase": "capturing", "cursor": 0, "winner": None,
                 "price": None, "failed": [], "voided": {}, "events": [], "cap_id": None,
                 "candidates": [[b, p] for b, p in self.ranking]}
            self._save(j, "init")
        if j["phase"] == "capturing":
            self._capture_phase(j)
        if j["phase"] == "voiding":
            self._void_phase(j)
        return j

    def _capture_phase(self, j):
        while j["cursor"] < len(j["candidates"]):
            bidder, price = j["candidates"][j["cursor"]]
            if price > self.ceilings[bidder]:
                raise SagaInvariantError("price above ceiling")
            if price < self.reserve:
                j["cursor"] += 1; self._save(j, "skip_below_reserve"); continue
            auth = self.holds[bidder]
            rid = f"capture-{self.aid}-{bidder}"
            # resume safety: did a previous run already capture on this auth?
            state = self._call("get", lambda: self.pp.get_authorization(auth))
            if rid in state["capture_request_ids"]:
                if state["captured"] != price: raise SagaInvariantError("captured amount mismatch")
                cap_id = "adopted"
            else:
                try:
                    res = self._call("capture", lambda: self.pp.capture(auth, price, True, rid))
                    cap_id = res["id"]
                except PayPalError as e:
                    # definite failure -> nothing captured; try runner-up
                    j["failed"].append([bidder, e.name]); j["cursor"] += 1
                    self._save(j, "capture_failed")
                    continue
                except Pending:
                    # unknown outcome: re-check truth before giving up; never fall through to runner-up
                    raise
            j.update(winner=bidder, price=price, cap_id=cap_id, phase="voiding")
            self._save(j, "capture_recorded")
            return
        j["phase"] = "voiding"      # no sale
        self._save(j, "no_sale")

    def _void_phase(self, j):
        for bidder, auth in sorted(self.holds.items()):
            if bidder == j["winner"] or bidder in j["voided"]:
                continue
            rid = f"void-{self.aid}-{bidder}"
            try:
                self._call("void", lambda: self.pp.void(auth, rid))
                j["voided"][bidder] = "voided"
            except PayPalError as e:
                if e.name in ("AUTHORIZATION_ALREADY_VOIDED", "AUTHORIZATION_EXPIRED"):
                    j["voided"][bidder] = "already_" + e.name.split("_")[-1].lower()
                else:
                    raise
            self._save(j, "void:" + bidder)
        j["phase"] = "done"
        self._save(j, "done")

    # --- webhook intake: idempotent, order-independent
    def on_webhook(self, event):
        j = self.store.load()
        if j is None or event["id"] in j["events"]:
            return False
        j["events"].append(event["id"])
        self.store.save(j)
        return True


def ranking_from_outcome(out):
    """Capture order: hammer winner at hammer price, then runner-ups at their own best bid."""
    if out.winner is None:
        return []
    return [(out.winner, out.price)] + [(b, amt) for b, amt in out.ranking[1:]]
