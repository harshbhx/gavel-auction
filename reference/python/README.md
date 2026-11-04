# GAVEL engine prototype (toy, offline)
Deterministic auction engine + fake PayPal + settlement saga + fallback bid parser. No network, no secrets.
- engine.py: OPEN->CLOSING->SETTLING->DONE; english / proxy (max-bid) / second_price; reserve, min increment, soft close, tie by earliest ts, ceiling check. Money = integer cents.
- fake_paypal.py: in-memory authorize/capture/void/reauthorize, injectable clock, honor 3d / validity 29d, idempotency (PayPal-Request-Id), partial+final capture, failure injection, webhooks outbox (duplicate/shuffle), invariants.
- saga.py: journaled capture-then-void saga, crash hook at every boundary, resume.
- parser.py + parser_cases.py + run_parser_eval.py: rule-based transcript parser and a labelled synthetic set (109 utterances). No real STT/LLM was run.
Run: `python3 -m venv .venv && .venv/bin/pip install pytest hypothesis && .venv/bin/python -m pytest -q` (about 5 s), `.venv/bin/python run_parser_eval.py`.
