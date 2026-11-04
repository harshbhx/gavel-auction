"""GAVEL deterministic auction engine. Money = integer minor units (cents).

Modes:
  english      ascending open outcry; each bid >= price+min_increment; winner pays top bid.
  proxy        bids are max-bids (eBay style); price = min(top_max, second_max+inc) (>= reserve).
  second_price sealed, one bid per bidder; winner pays max(reserve, second-highest bid).
Ties on amount: earliest timestamp wins (then arrival seq). Bids above the bidder's
authorized ceiling are rejected. State machine: OPEN -> CLOSING -> SETTLING -> DONE.
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
        if self.state is State.OPEN and now >= self.end_ts:
            self.state = State.CLOSING
        return self.state

    def place_bid(self, bidder: str, amount: int, ts: float) -> dict:
        self.tick(ts)
        if self.state is not State.OPEN:
            raise Rejected("closed")
        if bidder not in self.ceilings:
            raise Rejected("unregistered")
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
            self.end_ts = max(self.end_ts, ts + self.ext)
            self.extensions += 1
        return {"price": self.price(), "leader": self.leader(), "end_ts": self.end_ts}

    def hammer(self, now: float) -> Outcome:
        self.tick(now)
        if self.state is not State.CLOSING:
            raise Rejected("cannot_hammer", self.state.value)
        r = self.ranking()
        if not r:
            out = Outcome(None, 0, ())
        else:
            win = r[0][0]
            if self.mode == "english":
                price = r[0][1]
            elif self.mode == "proxy":
                price = self.price()
            else:
                price = self.reserve if len(r) == 1 else max(self.reserve, r[1][1])
            out = Outcome(win, price, tuple(r))
            assert price <= self.ceilings[win], "engine invariant: price <= ceiling"
        self.outcome = out
        self.state = State.SETTLING
        return out

    def complete(self):
        if self.state is not State.SETTLING:
            raise Rejected("cannot_complete", self.state.value)
        self.state = State.DONE
