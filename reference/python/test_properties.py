"""Simulation / property tests. TOY MODELS - they check mechanism logic, not real human behaviour."""
import random, statistics
import pytest
from engine import Auction, Rejected


def sealed(bids, reserve=1):
    a = Auction("S", "second_price", reserve=reserve, end_ts=10)
    for i, (b, v) in enumerate(bids):
        a.register(b, 10**9)
        try: a.place_bid(b, v, float(i))
        except Rejected: pass
    a.tick(10); return a.hammer(10)


def utility(out, who, value):
    return value - out.price if out.winner == who else 0


def test_vickrey_truthful_weakly_dominant_seeded():
    rng = random.Random(1234); strict = 0
    for _ in range(4000):
        n = rng.randint(2, 6)
        v = rng.randint(1, 1000)                       # my true value
        rivals = [("r%d" % i, rng.randint(1, 1000)) for i in range(n - 1)]
        reserve = rng.randint(1, 300)
        truthful = utility(sealed([("me", v)] + rivals, reserve), "me", v)
        for dev in [rng.randint(1, 1500) for _ in range(5)] + [max(1, v - 1), v + 1, 1, 10**6]:
            u = utility(sealed([("me", dev)] + rivals, reserve), "me", v)
            assert u <= truthful, (v, dev, rivals, reserve, u, truthful)   # never strictly better to deviate
            strict += u < truthful
        # note bidding truthfully below reserve means abstaining; covered since rejected bids give 0 utility
    assert strict > 0       # sanity: deviations CAN hurt, so the test is not vacuous


def test_vickrey_tie_break_does_not_break_dominance():
    # all rivals bid same as me; earliest ts wins. Deviation up cannot give positive profit.
    out = sealed([("me", 500), ("x", 500)]); assert utility(out, "me", 500) == 0
    out = sealed([("x", 500), ("me", 600)]); assert out.winner == "me" and out.price == 500


def first_price_revenue(vals, shade):
    bids = [v * shade for v in vals]; return max(bids)


def test_revenue_first_price_shading_vs_second_price_toy():
    """Toy: n i.i.d. U[0,1] values, risk-neutral. BNE first-price bid = (n-1)/n * v; second-price = truthful.
    Revenue equivalence predicts equal expected revenue (n-1)/(n+1). We check that over 20k seeded runs, and
    that mis-calibrated shading moves revenue the expected way. NOT evidence about real bidders/LLM bidders."""
    n, R = 4, 20000
    rng = random.Random(7)
    fp, sp, fp_over, fp_none = [], [], [], []
    for _ in range(R):
        vals = [rng.random() for _ in range(n)]
        fp.append(first_price_revenue(vals, (n - 1) / n))
        fp_over.append(first_price_revenue(vals, 0.5))     # over-shading
        fp_none.append(first_price_revenue(vals, 1.0))     # naive: bid value in first-price
        a = Auction("x", "second_price", reserve=1, end_ts=10)
        for i, v in enumerate(vals):
            a.register(str(i), 10**9); a.place_bid(str(i), max(1, int(v * 10**6)), float(i))
        a.tick(10); sp.append(a.hammer(10).price / 10**6)
    exp = (n - 1) / (n + 1)
    m_fp, m_sp = statistics.mean(fp), statistics.mean(sp)
    se = statistics.pstdev(fp) / R ** 0.5 * 4
    assert abs(m_fp - exp) < se and abs(m_sp - exp) < se
    assert abs(m_fp - m_sp) < 2 * se                 # revenue equivalence (stat. indistinguishable)
    assert statistics.mean(fp_over) < m_sp < statistics.mean(fp_none)   # shading too much loses revenue
    print(f"\nrevenue n={n} R={R}: first-price BNE={m_fp:.4f} second-price={m_sp:.4f} theory={exp:.4f} "
          f"over-shade(0.5)={statistics.mean(fp_over):.4f} no-shade={statistics.mean(fp_none):.4f}")


def test_english_ascending_clock_matches_second_price_outcome():
    """With myopic 'bid minimum increment until value' bidders, English winner = highest value and price within
    one increment of second-highest value (the classic ascending/second-price equivalence)."""
    rng = random.Random(99)
    for _ in range(300):
        vals = {f"b{i}": rng.randint(150, 900) for i in range(rng.randint(2, 5))}
        if len(set(vals.values())) < len(vals): continue
        inc = 5
        a = Auction("E", "english", reserve=100, min_increment=inc, end_ts=10**6)
        for b in vals: a.register(b, 10**6)
        t, active = 0.0, True
        while active:
            active = False
            for b in sorted(vals, key=lambda x: rng.random()):
                p = a.price(); need = a.reserve if p is None else p + inc
                if vals[b] >= need and a.leader() != b:
                    t += 1; a.place_bid(b, need, t); active = True
        a.tick(10**6); out = a.hammer(10**6)
        top = sorted(vals.values())
        # increment-grid artifact: if the top two values are within one increment the runner-up can win
        if top[-1] - top[-2] >= inc: assert out.winner == max(vals, key=vals.get)
        # the clock stops once nobody else can reach price + inc, so the winner only has to afford the price
        else: assert vals[out.winner] >= out.price
        assert top[-2] - inc < out.price <= top[-2] + inc


def test_conservation_random_auctions_through_saga():
    from saga import Saga, JournalStore
    from fake_paypal import FakePayPal, Clock
    rng = random.Random(5)
    for k in range(150):
        mode = rng.choice(["english", "proxy", "second_price"])
        pp = FakePayPal(Clock()); au = Auction("R", mode, reserve=100, min_increment=10, end_ts=50)
        holds, ceil = {}, {}
        for i in range(rng.randint(1, 6)):
            b = f"b{i}"; ceil[b] = rng.randint(100, 2000)
            au.register(b, ceil[b]); holds[b] = pp.create_authorization(b, ceil[b])["id"]
        for t in range(rng.randint(0, 25)):
            try: au.place_bid(rng.choice(list(holds)), rng.randint(50, 2100), float(t))
            except Rejected: pass
        au.tick(50); out = au.hammer(50)
        from saga import ranking_from_outcome; rk = ranking_from_outcome(out)
        if rng.random() < .3: pp.inject("capture", "timeout_after_success")
        Saga("R", JournalStore(), pp, holds, ceil, rk, 100).run()
        pp.check_invariants()
        cap = sum(pp.auths[a].captured for a in holds.values())
        rel = sum(pp.released(a) for a in holds.values())
        assert cap + rel == sum(ceil.values())
        assert cap == (out.price if out.winner else 0)
        assert sum(len(pp.auths[a].captures) for a in holds.values()) == (1 if out.winner else 0)
