import pytest
from hypothesis import given, strategies as st, settings
from engine import Auction, Rejected, State


def mk(mode="english", reserve=100, inc=10, ceil=None, **kw):
    a = Auction("A1", mode, reserve=reserve, min_increment=inc, end_ts=100, **kw)
    for b, c in (ceil or {"a": 1000, "b": 1000, "c": 1000}).items():
        a.register(b, c)
    return a


def test_state_machine_order():
    a = mk()
    assert a.state is State.OPEN
    a.place_bid("a", 100, 1)
    with pytest.raises(Rejected): a.hammer(50)            # not closing yet
    a.tick(100); assert a.state is State.CLOSING
    out = a.hammer(100); assert a.state is State.SETTLING and out.winner == "a"
    with pytest.raises(Rejected): a.place_bid("b", 500, 101)
    a.complete(); assert a.state is State.DONE
    with pytest.raises(Rejected): a.complete()


def test_english_increment_reserve_and_leader():
    a = mk()
    with pytest.raises(Rejected) as e: a.place_bid("a", 90, 1)
    assert e.value.code == "below_reserve"
    a.place_bid("a", 100, 1)
    with pytest.raises(Rejected) as e: a.place_bid("b", 105, 2)
    assert e.value.code == "below_increment"
    with pytest.raises(Rejected) as e: a.place_bid("a", 200, 2)
    assert e.value.code == "already_leading"
    a.place_bid("b", 110, 3)
    assert a.price() == 110 and a.leader() == "b"


def test_over_ceiling_rejected_all_modes():
    for mode in ("english", "proxy", "second_price"):
        a = mk(mode, ceil={"a": 300, "b": 1000})
        with pytest.raises(Rejected) as e: a.place_bid("a", 301, 1)
        assert e.value.code == "over_ceiling"
        assert a.bids == []


def test_unregistered_and_bad_amount():
    a = mk()
    with pytest.raises(Rejected): a.place_bid("zzz", 200, 1)
    with pytest.raises(Rejected): a.place_bid("a", -5, 1)
    with pytest.raises(Rejected): a.place_bid("a", 100.5, 1)


def test_soft_close_extends_and_is_capped():
    a = mk(soft_close_window=10, soft_close_extension=15, max_extensions=2)
    a.place_bid("a", 100, 95); assert a.end_ts == 110       # 95+15
    a.place_bid("b", 110, 105); assert a.end_ts == 120
    r = a.place_bid("a", 120, 115); assert a.end_ts == 120  # cap reached, no further extension
    with pytest.raises(Rejected): a.place_bid("b", 130, 121)  # closed


def test_soft_close_not_triggered_early():
    a = mk(soft_close_window=10, soft_close_extension=15)
    a.place_bid("a", 100, 50); assert a.end_ts == 100


def test_proxy_price_rules():
    a = mk("proxy", reserve=100, inc=10)
    a.place_bid("a", 500, 1); assert a.price() == 100       # alone: reserve
    a.place_bid("b", 300, 2); assert a.price() == 310 and a.leader() == "a"
    a.place_bid("b", 495, 3); assert a.price() == 500       # capped at top max
    a.place_bid("c", 800, 4); assert a.leader() == "c" and a.price() == 510
    with pytest.raises(Rejected): a.place_bid("c", 700, 5)  # not higher than own max
    a.tick(100); out = a.hammer(100)
    assert out.winner == "c" and out.price == 510


def test_proxy_tie_earliest_wins_pays_tie_amount():
    a = mk("proxy")
    a.place_bid("a", 400, 5); a.place_bid("b", 400, 6)
    out = (a.tick(100), a.hammer(100))[1]
    assert out.winner == "a" and out.price == 400


def test_second_price_winner_pays_second_or_reserve():
    a = mk("second_price", reserve=100)
    a.place_bid("a", 700, 1); a.place_bid("b", 400, 2); a.place_bid("c", 550, 3)
    out = (a.tick(100), a.hammer(100))[1]
    assert (out.winner, out.price) == ("a", 550)
    a = mk("second_price", reserve=100); a.place_bid("a", 700, 1)
    out = (a.tick(100), a.hammer(100))[1]; assert out.price == 100
    a = mk("second_price", reserve=300); a.place_bid("a", 700, 1); a.place_bid("b", 350, 2)
    out = (a.tick(100), a.hammer(100))[1]; assert out.price == 350


def test_second_price_second_bid_below_reserve_rejected_so_reserve_binds():
    a = mk("second_price", reserve=300)
    with pytest.raises(Rejected): a.place_bid("b", 200, 1)


def test_second_price_tie_earliest_timestamp_even_if_arrives_late():
    a = mk("second_price")
    a.place_bid("b", 500, 7.0); a.place_bid("a", 500, 3.0)   # a spoke first, transcript arrived later
    out = (a.tick(100), a.hammer(100))[1]
    assert out.winner == "a" and out.price == 500


def test_no_bids_no_sale():
    a = mk(); a.tick(100); out = a.hammer(100)
    assert out.winner is None


def test_second_price_one_bid_each():
    a = mk("second_price"); a.place_bid("a", 200, 1)
    with pytest.raises(Rejected): a.place_bid("a", 300, 2)


bid_seq = st.lists(st.tuples(st.sampled_from("abc"), st.integers(1, 1500)), max_size=40)


@settings(max_examples=150, deadline=None)
@given(bid_seq, st.sampled_from(["english", "proxy"]))
def test_price_monotonic_and_below_ceiling(seq, mode):
    a = mk(mode, reserve=50, inc=7, ceil={"a": 900, "b": 1200, "c": 600})
    last = 0
    for i, (b, amt) in enumerate(seq):
        try: a.place_bid(b, amt, float(i))
        except Rejected: continue
        p = a.price()
        assert p >= last
        last = p
        assert p <= a.ceilings[a.leader()]
    a.tick(100)
    out = a.hammer(100)
    if out.winner:
        assert out.price == a.price() and out.price <= a.ceilings[out.winner] and out.price >= 50


@settings(max_examples=150, deadline=None)
@given(bid_seq)
def test_second_price_winner_pays_second_highest(seq):
    a = mk("second_price", reserve=50, inc=1, ceil={"a": 900, "b": 1200, "c": 600})
    for i, (b, amt) in enumerate(seq):
        try: a.place_bid(b, amt, float(i))
        except Rejected: pass
    a.tick(100); out = a.hammer(100)
    r = a.ranking()
    if not r: assert out.winner is None
    else:
        assert out.winner == r[0][0]
        assert out.price == (50 if len(r) == 1 else max(50, r[1][1]))
        assert out.price <= r[0][1]
