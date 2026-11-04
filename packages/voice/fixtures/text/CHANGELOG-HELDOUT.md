# Held-out text set changelog

The held-out cases (`"set": "heldout"` in cases.json) must never be used to tune the lexicon or
thresholds. Any change to them needs a new line here, in date order, naming the new SHA-256 and the
reason, and the same hash recorded in HELDOUT.sha256. Format: `- YYYY-MM-DD <sha256> <reason>`.

- 2026-11-04 8c1f2874b1c13b12d9ed7eee2d19e52318c814e786f8c5b1d0d86ed2ea06e80f initial held-out set, ported unchanged from HELDOUT in reference/python/parser_cases.py
- 2026-11-04 a8decc387375ce343551648f3332a9fce7b25348492f85f86b8bc0968bd1dedd added 12 held-out cases from the extended corpus (VOX-40), dev set unchanged apart from 48 new cases
