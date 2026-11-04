"""Hand-written SYNTHETIC noisy utterances (no real STT audio, no LLM). Written by the same author as the
parser -> optimistic dev set. Tuple: (category, text, speaker, current_price, expected)
expected: ("bid", bidder, amount) | ("confirm",) | ("none",)"""
B = lambda b, a: ("bid", b, a)
C, N = ("confirm",), ("none",)
CASES = [
 # plain
 ("plain", "two hundred", "4", None, B("4", 200)),
 ("plain", "three hundred", "4", None, B("4", 300)),
 ("plain", "I'll go three hundred", "9", None, B("9", 300)),
 ("plain", "four hundred and fifty", "2", None, B("2", 450)),
 ("plain", "one thousand", "2", None, B("2", 1000)),
 ("plain", "two thousand five hundred", "3", None, B("3", 2500)),
 ("plain", "five hundred dollars", "5", None, B("5", 500)),
 ("plain", "I bid seventy five", "6", None, B("6", 75)),
 ("plain", "ninety", "6", None, B("6", 90)),
 ("plain", "a hundred and twenty", "1", None, B("1", 120)),
 ("plain", "um I'll say six hundred", "8", None, B("8", 600)),
 ("plain", "$350", "8", None, B("8", 350)),
 ("plain", "420 dollars", "8", None, B("8", 420)),
 # colloquial
 ("colloquial", "two fifty", "7", None, B("7", 250)),
 ("colloquial", "two-fifty-five", "7", None, B("7", 255)),
 ("colloquial", "three seventy five", "7", None, B("7", 375)),
 ("colloquial", "one twenty", "7", None, B("7", 120)),
 ("colloquial", "twelve fifty", "7", None, B("7", 1250)),
 ("colloquial", "fifteen hundred", "7", None, B("7", 1500)),
 ("colloquial", "eight fifty", "3", None, B("3", 850)),
 ("colloquial", "nine twenty five", "3", None, B("3", 925)),
 ("colloquial", "go two sixty", "3", None, B("3", 260)),
 # paddle
 ("paddle", "two-fifty-five from paddle twelve", None, None, B("12", 255)),
 ("paddle", "paddle 7 three hundred", None, None, B("7", 300)),
 ("paddle", "bidder number nine four hundred", None, None, B("9", 400)),
 ("paddle", "number twenty one, five hundred", None, None, B("21", 500)),
 ("paddle", "three hundred from paddle fourteen", None, None, B("14", 300)),
 ("paddle", "paddle five, two fifty", None, None, B("5", 250)),
 ("paddle", "seat 3 plays 600", None, None, B("3", 600)),
 ("paddle", "three hundred", None, None, C),   # no speaker, no paddle -> must ask
 # numerals / symbols
 ("numeral", "1.5k", "2", None, B("2", 1500)),
 ("numeral", "2k", "2", None, B("2", 2000)),
 ("numeral", "$1,500", "2", None, B("2", 1500)),
 ("numeral", "1500", "2", None, B("2", 1500)),
 ("numeral", "I'll do 2.5 k", "2", None, B("2", 2500)),
 ("numeral", "one point five k", "2", None, B("2", 1500)),
 ("numeral", "two grand", "2", None, B("2", 2000)),
 ("numeral", "3 hundred", "2", None, B("2", 300)),
 ("numeral", "paddle 12 for 1,250", None, None, B("12", 1250)),
 # asr errors
 ("asr_error", "to fifty", "7", None, B("7", 250)),  # sentence-initial 'to' read as 'two' (no verb before it)
 ("asr_error", "too hundred", "7", None, B("7", 200)),
 ("asr_error", "free hundred", "7", None, B("7", 300)),
 ("asr_error", "for hunderd", "7", None, B("7", 400)),
 ("asr_error", "five hundread", "7", None, B("7", 500)),
 ("asr_error", "tree fifty", "7", None, B("7", 350)),
 ("asr_error", "I'll go to hundred and fifty", "7", None, C),  # label changed after policy: 'to' ambiguous (150 vs 250)
 ("asr_error", "paddle ate, two fifty", None, None, B("8", 250)),
 ("asr_error", "won thousand", "7", None, B("7", 1000)),
 ("asr_error", "two thousend", "7", None, B("7", 2000)),
 ("asr_error", "uh, three, hundred", "7", None, B("7", 300)),
 ("asr_error", "THREE HUNDRED!!", "7", None, B("7", 300)),
 # homophone fifty/fifteen with price context
 ("homophone", "two fifteen", "7", 240, C),       # 215 below price; 250 plausible
 ("homophone", "fifteen", "7", 40, C),            # 15 < 40, "fifty" plausible
 ("homophone", "three sixteen", "7", 350, C),
 ("homophone", "two fifty", "7", 240, B("7", 250)),
 ("homophone", "two fifteen", "7", 100, B("7", 215)),
 ("homophone", "eighty", "7", 60, B("7", 80)),
 ("homophone", "fifty", "7", 40, B("7", 50)),
 # adversarial: ambiguous amount
 ("ambiguous", "two fifty or three hundred", "7", None, C),
 ("ambiguous", "two fifty, no three hundred", "7", None, C),
 ("ambiguous", "maybe two fifty", "7", None, C),
 ("ambiguous", "I was thinking about two hundred", "7", None, C),
 ("ambiguous", "somewhere between two and three hundred", "7", None, C),
 ("ambiguous", "two twenty fifty", "7", None, C),
 # two bidders
 ("two_bidders", "paddle five two fifty paddle nine two sixty", None, None, C),
 ("two_bidders", "paddle 5 300 paddle 9 300", None, None, C),
 ("two_bidders", "number three three hundred bidder eight three hundred", None, None, C),
 ("two_bidders", "seat two four hundred seat six four fifty", None, None, C),
 # corrections
 ("correction", "two fifty no wait three hundred", "7", None, C),
 ("correction", "three hundred sorry I mean two hundred", "7", None, C),
 ("correction", "scratch that", "7", None, C),
 ("correction", "actually never mind", "7", None, C),
 ("correction", "four hundred, wait no, forget it", "7", None, C),
 # non-bids
 ("non_bid", "how much is it now", "7", None, N),
 ("non_bid", "is it two fifty?", "7", None, N),
 ("non_bid", "the price is now two hundred", "7", None, N),
 ("non_bid", "nice vase", "7", None, N),
 ("non_bid", "did he say three hundred", "7", None, N),
 ("non_bid", "we are at two fifty now", "7", None, N),   # auctioneer echo: should NOT be a bid
 ("non_bid", "lot number seven please", None, None, N),
 ("non_bid", "my wife says no", "7", None, N),
]

# HELD-OUT set: written after the parser was tuned on CASES; never used to tune. Same author, so still optimistic.
HELDOUT = [
 ("plain", "let's do six fifty", "2", None, B("2", 650)),
 ("plain", "seven hundred and twenty five", "2", None, B("2", 725)),
 ("plain", "I raise to eight hundred", "2", None, B("2", 800)),
 ("colloquial", "four forty", "5", None, B("5", 440)),
 ("colloquial", "one fifty five", "5", None, B("5", 155)),
 ("colloquial", "nineteen hundred", "5", None, B("5", 1900)),
 ("paddle", "paddle thirty, five hundred", None, None, B("30", 500)),
 ("paddle", "bidder 4 says six hundred", None, None, B("4", 600)),
 ("paddle", "five hundred from paddle twenty two", None, None, B("22", 500)),
 ("numeral", "$2.5k", "6", None, B("6", 2500)),
 ("numeral", "three point five k", "6", None, B("6", 3500)),
 ("numeral", "10k", "6", None, B("6", 10000)),
 ("asr_error", "tree hundred", "6", None, B("6", 300)),
 ("asr_error", "fore fifty", "6", None, B("6", 450)),
 ("asr_error", "to thousand", "6", None, B("6", 2000)),
 ("asr_error", "I'll go sirty", "6", None, B("6", 30)),
 ("homophone", "sixteen hundred", "6", 1650, C),
 ("homophone", "thirty", "6", 20, B("6", 30)),
 ("ambiguous", "two hundred, or two fifty, not sure", "6", None, C),
 ("ambiguous", "around three hundred", "6", None, C),
 ("two_bidders", "bidder 2 six hundred bidder 3 six fifty", None, None, C),
 ("correction", "five hundred, I mean four", "6", None, C),
 ("non_bid", "who has two fifty", "6", None, N),
 ("non_bid", "that's two hundred going once", "6", None, N),
 ("non_bid", "sold for three hundred to paddle five", None, None, N),
 ("non_bid", "the reserve is one hundred", "6", None, N),
 ("non_bid", "I have two kids", "6", None, N),
 ("non_bid", "give me a second", "6", None, N),
]
