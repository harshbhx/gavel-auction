"""GAVEL deterministic auction engine. Money = integer minor units (cents).

Modes:
  english      ascending open outcry; each bid >= price+min_increment; winner pays top bid.
  proxy        bids are max-bids (eBay style); price = min(top_max, second_max+inc) (>= reserve).
  second_price sealed, one bid per bidder; winner pays max(reserve, second-highest bid).
Ties on amount: earliest timestamp wins (then arrival seq). Bids above the bidder's
authorized ceiling are rejected. State machine: OPEN -> CLOSING -> SETTLING -> DONE.

Operator commands (D-0030): revoke (strikes a bidder's bids before the hammer), promote (runner-up
fallback after the hammer), abort (kill switch before the hammer) and pause / resume / extend
(clock control of an OPEN lot). A lot with no bids at the hammer, an aborted lot and a lot whose
last candidate was disqualified end DONE with no winner. Reject codes match the TypeScript engine,
except that its `lot_not_open` is called `closed` here.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

MODES = ("english", "proxy", "second_price")


class State(str, Enum):
    OPEN = "OPEN"
    CLOSING = "CLOSING"
    SETTLING = "SETTLING"
    DONE = "DONE"


class Rejected(Exception):
    def __init__(self, code: str, msg: str = ""):
        super().__init__(f"{code}: {msg}")
        self.code = code


@dataclass(frozen=True)
class Bid:
    bidder: str
    amount: int
    ts: float
    seq: int


@dataclass(frozen=True)
class Outcome:
    winner: Optional[str]
    price: int
    ranking: tuple  # ((bidder, best_amount), ...) best first; used for runner-up fallback


class Auction:
    def __init__(self, auction_id, mode="english", reserve=1, min_increment=1,
                 end_ts=100.0, soft_close_window=0.0, soft_close_extension=0.0,
                 max_extensions=10):
        assert mode in MODES
        assert reserve >= 1 and min_increment >= 1
        self.id, self.mode, self.reserve, self.inc = auction_id, mode, reserve, min_increment
        self.end_ts = end_ts
        self.window, self.ext, self.max_ext = soft_close_window, soft_close_extension, max_extensions
        self.extensions = 0
        self.state = State.OPEN
        self.ceilings: dict[str, int] = {}
        self.bids: list[Bid] = []
        self._seq = 0
        self.outcome: Optional[Outcome] = None
        self.revoked: set[str] = set()
        self.struck: set[int] = set()      # seq of bids struck by a revoke
        self.paused_remaining = None        # time left while the clock is paused
        self.demoted: list[str] = []
        self.skipped: list[str] = []
        self.depth = 0
        self.max_fallback_depth = 2

    # ---- registration
    def register(self, bidder: str, ceiling: int):
        if self.state is not State.OPEN:
            raise Rejected("not_open")
        if ceiling < 1:
            raise Rejected("bad_ceiling")
        self.ceilings[bidder] = ceiling

    # ---- helpers
    def _best(self) -> dict:
        """bidder -> best Bid (highest amount; earliest ts/seq on equal)."""
        best: dict[str, Bid] = {}
        for b in self.bids:
            if b.seq in self.struck:
                continue
            cur = best.get(b.bidder)
            if cur is None or (b.amount, -b.ts, -b.seq) > (cur.amount, -cur.ts, -cur.seq):
                best[b.bidder] = b
        return best

    def ranking(self) -> list:
        order = sorted(self._best().values(), key=lambda b: (-b.amount, b.ts, b.seq))
        return [(b.bidder, b.amount) for b in order]

    def price(self) -> Optional[int]:
        """Current public price (None for sealed mode or when no bids)."""
        if self.mode == "second_price":
            return None
        r = self.ranking()
        if not r:
            return None
        if self.mode == "english":
            return r[0][1]
        if len(r) == 1:
            return self.reserve
        return max(self.reserve, min(r[0][1], r[1][1] + self.inc))

    def leader(self) -> Optional[str]:
        r = self.ranking()
        return r[0][0] if r else None

    # ---- lifecycle
    def tick(self, now: float):
        if self.state is State.OPEN and self.paused_remaining is None and now >= self.end_ts:
            self.state = State.CLOSING
        return self.state

    def place_bid(self, bidder: str, amount: int, ts: float) -> dict:
        if self.state is State.DONE:
            raise Rejected("lot_done")
        self.tick(ts)
        if self.state is not State.OPEN or ts >= self.end_ts or self.paused_remaining is not None:
            raise Rejected("closed")
        if bidder not in self.ceilings:
            raise Rejected("unregistered")
        if bidder in self.revoked:
            raise Rejected("ceiling_revoked")
        if not isinstance(amount, int) or amount <= 0:
            raise Rejected("bad_amount")
        if amount > self.ceilings[bidder]:
            raise Rejected("over_ceiling", f"{amount} > {self.ceilings[bidder]}")
        if amount < self.reserve:
            raise Rejected("below_reserve")
        best = self._best().get(bidder)
        if self.mode == "english":
            p = self.price()
            if p is not None and amount < p + self.inc:
                raise Rejected("below_increment")
            if self.leader() == bidder:
                raise Rejected("already_leading")
        elif self.mode == "proxy":
            if best and amount <= best.amount:
                raise Rejected("not_higher_than_own_max")
        else:
            if best:
                raise Rejected("already_bid")
        self._seq += 1
        self.bids.append(Bid(bidder, amount, ts, self._seq))
        if (self.mode != "second_price" and self.window and self.ext
                and ts >= self.end_ts - self.window and self.extensions < self.max_ext):
            new_end = max(self.end_ts, ts + self.ext)
            if new_end > self.end_ts:  # D-0027: an unchanged end is not an extension
                self.end_ts = new_end
                self.extensions += 1
        return {"price": self.price(), "leader": self.leader(), "end_ts": self.end_ts}

    def hammer(self, now: float) -> Outcome:
        if self.state is State.DONE:
            raise Rejected("lot_done")
        self.tick(now)
        if self.paused_remaining is not None or self.state is not State.CLOSING:
            raise Rejected("cannot_hammer", self.state.value)
        r = self.ranking()
        if not r:
            out = Outcome(None, 0, ())
            self.state = State.DONE  # unsold: no bids
        else:
            win = r[0][0]
            price = self._price_of(r)
            out = Outcome(win, price, tuple(r))
            assert price <= self.ceilings[win], "engine invariant: price <= ceiling"
            self.state = State.SETTLING
        self.outcome = out
        return out

    def _price_of(self, r: list) -> int:
        """Hammer price if the first entry of ranking `r` wins (D-0030: also used for fallback)."""
        if self.mode == "english":
            return r[0][1]
        if self.mode == "proxy":
            if len(r) == 1:
                return self.reserve
            return max(self.reserve, min(r[0][1], r[1][1] + self.inc))
        return self.reserve if len(r) == 1 else max(self.reserve, r[1][1])

    # ---- operator commands (D-0030)
    def revoke(self, bidder: str):
        """Revoke a bidder's ceiling. Before the hammer their bids are struck; after it only the flag."""
        if bidder not in self.ceilings:
            raise Rejected("bad_command", "unknown bidder")
        if bidder in self.revoked:
            return
        self.revoked.add(bidder)
        if self.state in (State.OPEN, State.CLOSING):
            self.struck.update(b.seq for b in self.bids if b.bidder == bidder)

    def abort(self):
        """Kill switch: an unhammered lot ends DONE with no winner. Bids stay, nothing is struck."""
        if self.state is State.DONE:
            raise Rejected("lot_done")
        if self.state is State.SETTLING:
            raise Rejected("lot_frozen")
        self.paused_remaining = None
        self.state = State.DONE
        self.outcome = Outcome(None, 0, ())

    def promote(self, disqualified: str):
        """Disqualify the current winner; the next valid runner-up wins at a recomputed price."""
        if self.state is State.DONE:
            raise Rejected("lot_done")
        if self.state is not State.SETTLING:
            raise Rejected("cannot_promote", self.state.value)
        if self.outcome is None or self.outcome.winner is None or self.outcome.winner != disqualified:
            raise Rejected("not_current_winner", disqualified)
        excluded = {disqualified, *self.demoted, *self.skipped}
        ranked = [e for e in self.ranking() if e[0] not in excluded]
        depth = self.depth
        for i in range(min(len(ranked), self.max_fallback_depth + 1)):
            rest = ranked[i:]
            who, price = rest[0][0], self._price_of(rest)
            depth += 1
            if depth > self.max_fallback_depth:
                break
            if who in self.revoked or price > self.ceilings[who]:
                self.skipped.append(who)
                continue
            self.demoted.append(disqualified)
            self.depth = depth
            self.outcome = Outcome(who, price, tuple(self.ranking()))
            return self.outcome
        self.state = State.DONE
        self.outcome = Outcome(None, 0, ())
        return self.outcome

    def _clock_lot(self):
        if self.state is State.DONE:
            raise Rejected("lot_done")
        if self.state is State.SETTLING:
            raise Rejected("lot_frozen")
        if self.state is not State.OPEN:
            raise Rejected("closed")

    def pause(self, now):
        self._clock_lot()
        if self.paused_remaining is not None:
            raise Rejected("bad_command", "already paused")
        if now >= self.end_ts:
            raise Rejected("closed", "deadline passed")
        self.paused_remaining = self.end_ts - now

    def resume(self, now):
        self._clock_lot()
        if self.paused_remaining is None:
            raise Rejected("bad_command", "not paused")
        self.end_ts = now + self.paused_remaining
        self.paused_remaining = None

    def extend(self, now, extra):
        """Add time to a running lot. Not a soft-close extension: `extensions` is unchanged."""
        self._clock_lot()
        if self.paused_remaining is not None:
            raise Rejected("bad_command", "resume first")
        if now >= self.end_ts:
            raise Rejected("closed", "deadline passed")
        self.end_ts += extra

    def complete(self):
        if self.state is not State.SETTLING:
            raise Rejected("cannot_complete", self.state.value)
        self.state = State.DONE
