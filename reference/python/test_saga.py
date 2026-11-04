import itertools
import pytest
from engine import Auction
from fake_paypal import FakePayPal, Clock, DAY
from saga import Saga, JournalStore, Crash, Pending

CEIL = {"a": 1000, "b": 800, "c": 600, "d": 900}


def world(mode="second_price", bids=None, **ppkw):
    clock = Clock(); pp = FakePayPal(clock, **ppkw)
    au = Auction("AUC", mode, reserve=100, min_increment=10, end_ts=100)
    holds = {}
    for b, c in CEIL.items():
        au.register(b, c); holds[b] = pp.create_authorization(b, c)["id"]
    for i, (b, amt) in enumerate(bids if bids is not None else [("a", 700), ("b", 400), ("c", 550), ("d", 300)]):
        au.place_bid(b, amt, float(i))
    au.tick(100); out = au.hammer(100)
    from saga import ranking_from_outcome; ranking = ranking_from_outcome(out)
    return pp, au, out, holds, ranking


def mksaga(pp, holds, ranking, store, hook=None, **kw):
    return Saga("AUC", store, pp, holds, CEIL, ranking, 100, crash_hook=hook, **kw)


def check_final(pp, holds, out, expect_winner=None, expect_price=None, sale=True):
    pp.check_invariants()
    caps = [(b, c) for b, a in holds.items() for c in pp.auths[a].captures]
    if not sale:
        assert caps == []
    else:
        assert len(caps) == 1, f"captures: {caps}"                       # AT MOST ONE EVER (and exactly one here)
        w, c = caps[0]
        assert c[2] is True                                               # final_capture
        assert c[1] <= CEIL[w]                                            # <= ceiling
        if expect_winner: assert w == expect_winner
        if expect_price: assert c[1] == expect_price
    for b, a in holds.items():
        au = pp.auths[a]
        if au.captures: continue
        assert au.void_effects <= 1
        assert au.status in ("VOIDED", "EXPIRED"), (b, au.status)
    # conservation: captured + released == holds
    cap = sum(pp.auths[a].captured for a in holds.values())
    rel = sum(pp.released(a) for a in holds.values())
    assert cap + rel == sum(pp.auths[a].hold for a in holds.values())


def test_happy_path_vickrey():
    pp, au, out, holds, rk = world()
    j = mksaga(pp, holds, rk, JournalStore()).run()
    assert j["phase"] == "done" and j["winner"] == "a" and j["price"] == 550
    check_final(pp, holds, out, "a", 550)
    assert pp.auths[holds["a"]].void_effects == 0 and all(pp.auths[holds[b]].void_effects == 1 for b in "bcd")


def test_no_sale_all_voided():
    pp, au, out, holds, rk = world(bids=[])
    mksaga(pp, holds, rk, JournalStore()).run()
    check_final(pp, holds, out, sale=False)
    assert all(pp.auths[a].void_effects == 1 for a in holds.values())


def test_rerun_after_done_is_noop():
    pp, au, out, holds, rk = world(); st = JournalStore()
    mksaga(pp, holds, rk, st).run(); n = len(pp.calls)
    mksaga(pp, holds, rk, st).run()
    assert len(pp.calls) == n


def test_price_above_ceiling_refused():
    pp, au, out, holds, rk = world()
    from saga import SagaInvariantError
    with pytest.raises(SagaInvariantError): mksaga(pp, holds, [("c", 601)], JournalStore()).run()
    assert all(not a.captures for a in pp.auths.values())


def labels_of(**kw):
    seen = []
    pp, au, out, holds, rk = world(**kw)
    mksaga(pp, holds, rk, JournalStore(), hook=seen.append).run()
    return seen


def run_with_crash(idx, pre=None, mid=None):
    pp, au, out, holds, rk = world()
    if pre: pre(pp, holds)
    st = JournalStore(); n = itertools.count()
    def hook(label):
        if next(n) == idx: raise Crash(label)
    try:
        mksaga(pp, holds, rk, st, hook=hook).run(); crashed = False
    except Crash: crashed = True
    if mid: mid(pp)
    j = mksaga(pp, holds, rk, st).run()      # fresh process, same durable journal
    assert j["phase"] == "done"
    check_final(pp, holds, out, "a", 550)
    return crashed


N_LABELS = len(labels_of())


def test_label_count_sane():
    assert N_LABELS >= 15


@pytest.mark.parametrize("idx", range(N_LABELS))
def test_crash_at_every_boundary_then_resume(idx):
    assert run_with_crash(idx) is True


@pytest.mark.parametrize("idx", range(N_LABELS))
def test_crash_everywhere_plus_lost_idempotency_cache(idx):
    # worst case: server forgot the idempotency key; saga's own get-before-capture must prevent a 2nd capture
    run_with_crash(idx, mid=lambda pp: pp.forget_idempotency())


@pytest.mark.parametrize("idx", range(0, N_LABELS, 3))
def test_crash_everywhere_plus_timeout_after_success(idx):
    def pre(pp, holds):
        pp.inject("capture", "timeout_after_success"); pp.inject("void", "timeout_after_success", times=2)
    run_with_crash(idx, pre=pre)


def test_double_crash_resume_chain():
    pp, au, out, holds, rk = world(); st = JournalStore()
    for idx in (3, 5, 7, 2):                   # crash repeatedly at different points on successive resumes
        n = itertools.count()
        def hook(label, idx=idx, n=n):
            if next(n) == idx: raise Crash(label)
        try: mksaga(pp, holds, rk, st, hook=hook).run()
        except Crash: pass
    mksaga(pp, holds, rk, st).run()
    check_final(pp, holds, out, "a", 550)


def test_capture_timeout_after_success_retried_in_run():
    pp, au, out, holds, rk = world()
    pp.inject("capture", "timeout_after_success")
    mksaga(pp, holds, rk, JournalStore()).run()
    check_final(pp, holds, out, "a", 550)


def test_persistent_timeouts_leave_pending_never_fallback():
    pp, au, out, holds, rk = world()
    pp.inject("capture", "timeout_before", times=3)     # all 3 attempts time out
    st = JournalStore()
    with pytest.raises(Pending): mksaga(pp, holds, rk, st).run()
    assert all(not a.captures for a in pp.auths.values())
    assert all(a.void_effects == 0 for a in pp.auths.values())       # nobody voided while outcome unknown
    mksaga(pp, holds, rk, st).run()
    check_final(pp, holds, out, "a", 550)


def test_winner_hold_expired_falls_back_to_runner_up_once():
    pp, au, out, holds, rk = world()
    pp.auths[holds["a"]].status = "EXPIRED"
    j = mksaga(pp, holds, rk, JournalStore()).run()
    assert j["winner"] == "c" and j["price"] == 550 and j["failed"][0][0] == "a"
    check_final(pp, holds, out, "c", 550)


def test_winner_hold_voided_externally_falls_back():
    pp, au, out, holds, rk = world()
    pp.void(holds["a"], "external")
    j = mksaga(pp, holds, rk, JournalStore()).run()
    assert j["winner"] == "c"
    check_final(pp, holds, out, "c")


def test_winner_hold_expires_by_clock_after_30_days():
    pp, au, out, holds, rk = world()
    pp.clock.advance(30 * DAY)
    j = mksaga(pp, holds, rk, JournalStore()).run()
    assert j["winner"] is None and j["phase"] == "done"      # everything expired -> no sale, no capture
    check_final(pp, holds, out, sale=False)


def test_declined_winner_falls_back_and_only_one_capture():
    pp, au, out, holds, rk = world()
    pp.inject("capture", "capture_declined", auth_id=holds["a"])
    j = mksaga(pp, holds, rk, JournalStore()).run()
    assert j["winner"] == "c"
    check_final(pp, holds, out, "c", 550)


def test_webhooks_duplicate_and_out_of_order_are_idempotent():
    pp, au, out, holds, rk = world(); st = JournalStore()
    s = mksaga(pp, holds, rk, st); s.run()
    outcomes = []
    for mode in ("fifo", "reverse", "shuffle"):
        for ev in pp.deliver(mode, duplicate=True, seed=1): outcomes.append(s.on_webhook(ev))
    j = st.load()
    assert len(j["events"]) == len(pp.events) == len(set(j["events"]))
    assert outcomes.count(True) == len(pp.events)
    check_final(pp, holds, out, "a", 550)


def test_english_and_proxy_modes_end_to_end():
    for mode, bids in (("english", [("a", 100), ("b", 110), ("a", 130), ("d", 200)]),
                       ("proxy", [("a", 700), ("b", 400), ("d", 650)])):
        pp, au, out, holds, rk = world(mode, bids)
        mksaga(pp, holds, rk, JournalStore()).run()
        check_final(pp, holds, out, out.winner, out.price)
