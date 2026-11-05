"""Deterministic fallback parser: noisy ASR transcript -> (bidder, amount).
parse(text, speaker=None, current_price=None) -> Parsed
  status: "bid" (act on it), "confirm" (ambiguous: ask the bidder), "none" (not a bid).
Amount is in whole currency units (dollars). No LLM, no STT was used anywhere.
"""
import re
from dataclasses import dataclass, field
from typing import Optional

UNITS = {"zero": 0, "oh": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
         "seven": 7, "eight": 8, "nine": 9}
TEENS = {"ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
         "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50, "sixty": 60,
        "seventy": 70, "eighty": 80, "ninety": 90}
# ASR confusions, applied only to tokens adjacent to number words
ASR = {"to": "two", "too": "two", "tu": "two", "for": "four", "fore": "four", "free": "three",
       "tree": "three", "ate": "eight", "won": "one", "fifthy": "fifty", "sirty": "thirty",
       "fiddy": "fifty", "hunderd": "hundred", "hundread": "hundred", "hunnerd": "hundred",
       "tousand": "thousand", "thousend": "thousand"}
SCALE = {"hundred": 100, "thousand": 1000, "grand": 1000, "k": 1000}
HOMOPH = {"fifty": "fifteen", "fifteen": "fifty", "sixty": "sixteen", "sixteen": "sixty",
          "seventy": "seventeen", "seventeen": "seventy", "eighty": "eighteen", "eighteen": "eighty",
          "ninety": "nineteen", "nineteen": "ninety", "thirty": "thirteen", "thirteen": "thirty",
          "forty": "fourteen", "fourteen": "forty"}
PADDLE_WORDS = {"paddle", "bidder", "number", "seat", "card", "paddy", "padel"}
CORRECTION = re.compile(r"\b(no wait|wait no|scratch that|never ?mind|i mean|sorry|actually|make that|strike that|cancel|withdraw)\b")
QUESTION_START = re.compile(r"^(is|did|was|what|how|who|can|could|does|do|are|why)\b")
HEDGE = re.compile(r"\b(maybe|perhaps|thinking|about|around|roughly|between|or so|not sure|might|i guess)\b")
NOT_BID_CTX = re.compile(r"\b(the price is|price is|it'?s at|now at|currently|reserve|starting|opening|we are at|we're at|(lot|item|page) number|do i hear|who(?:'|’)?ll give|who will give|will you give|can i get|going once|going twice|going three times|fair warning|sold|kids|years old|people)\b")


@dataclass
class Parsed:
    status: str
    bidder: Optional[str] = None
    amount: Optional[int] = None
    reason: str = ""
    candidates: list = field(default_factory=list)


def _norm(text):
    t = text.lower().replace("’", "'")
    t = re.sub(r"(?<=\d),(?=\d{3}\b)", "", t)         # 1,500 -> 1500
    t = re.sub(r"\$\s*", " ", t)
    t = re.sub(r"(\d)\s*k\b", r"\1 k", t)
    t = re.sub(r"(?<!\d)([.,;:!?\-])|([,;:!?\-])(?!\d)", " ", t)
    t = re.sub(r"(?<=\D)\.(?=\D)|\.\s", " ", t)
    return t.split()


def _is_num_tok(t):
    return (t in UNITS or t in TEENS or t in TENS or t in SCALE or t == "point"
            or re.fullmatch(r"\d+(\.\d+)?", t) is not None)


def _words_value(seq):
    """seq: list of number words (no digits). Returns int or None."""
    # decimal "one point five k"
    if "point" in seq:
        i = seq.index("point")
        a = _words_value(seq[:i]); frac = seq[i + 1:]
        if a is None or not frac or frac[-1] not in ("k", "thousand", "grand"):
            return None
        digs = [UNITS.get(w) for w in frac[:-1]]
        if not digs or any(d is None for d in digs): return None
        return int((a + float("0." + "".join(map(str, digs)))) * 1000 + 0.5)
    scale = None
    if seq and seq[-1] in ("k", "grand"):
        scale, seq = 1000, seq[:-1]
    if not seq:
        return None
    total, cur, seen_scale = 0, [], False
    if any(w in ("hundred", "thousand") for w in seq):
        total, cur_val = 0, 0
        for w in seq:
            if w in UNITS or w in TEENS or w in TENS:
                v = UNITS.get(w, TEENS.get(w, TENS.get(w)))
                cur_val += v
            elif w == "hundred":
                cur_val = max(cur_val, 1) * 100
            elif w == "thousand":
                total += max(cur_val, 1) * 1000; cur_val = 0
        # "two hundred fifty" -> 250 handled since cur_val keeps accumulating after *100
        val = total + cur_val
        # fix "one hundred and ..." accumulations like [two,hundred,fifty]: cur_val=200+50 ok
        return val * (scale or 1) if val else None
    vals = [UNITS.get(w, TEENS.get(w, TENS.get(w))) for w in seq]
    if any(v is None for v in vals): return None
    n = len(vals)
    if n == 1:
        v = vals[0]
        return v * (scale or 1)
    # colloquial hundreds: "two fifty", "twelve fifty", "two fifty five", "one twenty"
    a, b = vals[0], vals[1]
    if (a < 100 and a not in range(20, 100, 10) and b >= 10 and (b in range(20, 100, 10) or 10 <= b <= 19)
            and (a < 10 or 10 <= a <= 19)):
        if n == 2: return a * 100 + b
        if n == 3 and vals[2] < 10 and b >= 20 and b % 10 == 0: return a * 100 + b + vals[2]
        return None
    # standard: tens + unit ("fifty five")
    if n == 2 and a in range(20, 100, 10) and b < 10 and b > 0: return a + b
    if n == 2 and a < 10 and b < 10: return a * 10 + b       # "two five" -> 25 (digit read-out) weak
    return None


def _spans(tokens):
    """maximal runs of number tokens -> list of (start, end)."""
    spans, i = [], 0
    while i < len(tokens):
        if _is_num_tok(tokens[i]) and tokens[i] != "point" or (tokens[i] == "point" and False):
            j = i
            while j < len(tokens) and (_is_num_tok(tokens[j]) or (tokens[j] == "and" and j + 1 < len(tokens) and _is_num_tok(tokens[j + 1]) and j > i)):
                j += 1
            spans.append((i, j)); i = j
        else:
            i += 1
    return spans


def _span_value(toks):
    toks = [t for t in toks if t != "and"]
    if len(toks) == 1 and re.fullmatch(r"\d+(\.\d+)?", toks[0]):
        return int(float(toks[0]))
    # digit + k  (1.5 k, 2 k)
    if len(toks) == 2 and re.fullmatch(r"\d+(\.\d+)?", toks[0]) and toks[1] in ("k", "grand", "thousand"):
        return int(round(float(toks[0]) * 1000))
    if len(toks) == 2 and re.fullmatch(r"\d+", toks[0]) and toks[1] == "hundred":
        return int(toks[0]) * 100
    if any(re.fullmatch(r"\d+(\.\d+)?", t) for t in toks):
        return None
    return _words_value(toks)


def parse(text, speaker=None, current_price=None) -> Parsed:
    raw = text.strip().lower()
    toks = _norm(text)
    if not toks:
        return Parsed("none", reason="empty")
    # ASR repair near numbers / paddle words
    fixed = []
    for i, t in enumerate(toks):
        if t in ASR:
            nb = [toks[i - 1] if i else "", toks[i + 1] if i + 1 < len(toks) else ""]
            if any((n.isalpha() and _is_num_tok(ASR.get(n, n))) or n in PADDLE_WORDS for n in nb) or t in ("hunderd", "hundread", "hunnerd", "tousand", "thousend", "fifthy", "sirty", "fiddy"):
                fixed.append(ASR[t]); continue
        fixed.append(t)
    # 'to/too/for' right after a raising verb may be a preposition, not a digit: compare both readings
    PREP_VERB = {"raise", "up", "go", "goes", "bump", "make", "increase", "it", "bid", "say"}
    amb_prep = any(t in ("to", "too", "for") and i and toks[i - 1] in PREP_VERB and fixed[i] != t for i, t in enumerate(toks))
    prep_alt = [t for i, t in enumerate(toks) if not (t in ("to", "too", "for") and i and toks[i - 1] in PREP_VERB and fixed[i] != t)] if amb_prep else None
    toks = fixed
    if amb_prep:
        a, b = parse(" ".join(fixed), speaker, current_price), parse(" ".join(prep_alt), speaker, current_price)
        if (a.status, a.bidder, a.amount) != (b.status, b.bidder, b.amount):
            return Parsed("confirm", bidder=a.bidder, reason="to/for: preposition or digit?", candidates=sorted({x for x in (a.amount, b.amount) if x}))
    if CORRECTION.search(raw): return Parsed("confirm", reason="correction/retraction")
    if HEDGE.search(raw): return Parsed("confirm", reason="hedged amount")
    if "?" in raw or QUESTION_START.match(raw): return Parsed("none", reason="question")
    if NOT_BID_CTX.search(raw): return Parsed("none", reason="auctioneer/background talk")
    # paddles
    paddles, consumed = [], set()
    for i, t in enumerate(toks):
        if t in PADDLE_WORDS:
            j = i + 1
            while j < len(toks) and toks[j] in PADDLE_WORDS: j += 1   # "bidder number nine"
            if j >= len(toks): continue
            a = toks[j]
            if re.fullmatch(r"\d+", a):
                val, end = int(a), j + 1
            elif a in TENS and j + 1 < len(toks) and toks[j + 1] in UNITS and UNITS[toks[j + 1]] > 0 and not (j + 2 < len(toks) and toks[j + 2] in SCALE):
                val, end = TENS[a] + UNITS[toks[j + 1]], j + 2
            elif a in UNITS or a in TEENS or a in TENS:
                val, end = UNITS.get(a, TEENS.get(a, TENS.get(a))), j + 1
            else:
                continue
            paddles.append(str(val)); consumed.update(range(i, end))
    if len(set(paddles)) > 1: return Parsed("confirm", reason="multiple bidders", candidates=sorted(set(paddles)))
    bidder = paddles[0] if paddles else speaker
    rest = [t for i, t in enumerate(toks) if i not in consumed]
    # spans over the remaining tokens (a "k" or "grand" after digits belongs to number)
    spans = _spans(rest)
    vals = []
    for s, e in spans:
        v = _span_value(rest[s:e])
        if v: vals.append(v)
    if not vals:
        if spans: return Parsed("confirm", bidder=bidder, reason="uninterpretable number")
        return Parsed("none", reason="no amount")
    if len(set(vals)) > 1: return Parsed("confirm", bidder=bidder, reason="multiple amounts", candidates=sorted(set(vals)))
    amount = vals[0]
    # homophone ambiguity (fifty/fifteen) when context shows the literal reading is implausible
    if current_price is not None and amount <= current_price:
        alts = []
        for s, e in spans:
            seg = rest[s:e]
            for k, w in enumerate(seg):
                if w in HOMOPH:
                    v = _span_value(seg[:k] + [HOMOPH[w]] + seg[k + 1:])
                    if v and v > current_price: alts.append(v)
        if alts:
            return Parsed("confirm", bidder=bidder, amount=amount, reason="homophone", candidates=sorted(set([amount] + alts)))
    if bidder is None:
        return Parsed("confirm", amount=amount, reason="unknown bidder")
    return Parsed("bid", bidder=str(bidder), amount=amount)
