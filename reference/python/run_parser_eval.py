import collections
from parser import parse
from parser_cases import CASES, HELDOUT

def check(c):
    cat, text, spk, cp, exp = c
    p = parse(text, speaker=spk, current_price=cp)
    got = ("bid", p.bidder, p.amount) if p.status == "bid" else (p.status,)
    return got == exp, got

def table(cases):
    per = collections.OrderedDict(); fails = []
    for c in cases:
        ok, got = check(c)
        per.setdefault(c[0], [0, 0]); per[c[0]][1] += 1; per[c[0]][0] += ok
        if not ok: fails.append((c, got))
    return per, fails

def report(name, cases):
    per, fails = table(cases)
    tot = sum(v[0] for v in per.values()); n = sum(v[1] for v in per.values())
    print("==", name)
    print(f"{'category':<13}{'exact':>6}{'n':>4}{'acc':>7}")
    for k, (a, b) in per.items(): print(f"{k:<13}{a:>6}{b:>4}{a/b:>7.0%}")
    print(f"{'TOTAL':<13}{tot:>6}{n:>4}{tot/n:>7.0%}")
    for c, got in fails: print("FAIL", c[0], repr(c[1]), "spk", c[2], "exp", c[4], "got", got)
    return tot, n

if __name__ == "__main__":
    report("DEV (tuned on; optimistic)", CASES)
    report("HELD-OUT (not tuned on)", HELDOUT)
