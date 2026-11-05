# Public repo checklist

Use this list to check the repository before it is shared with judges or the public.

Rule: an item is marked [x] only after it is verified on `main`. An item marked [ ] needs an owner action or a passing run.

## License and policies

- [x] License present: `LICENSE` (MIT), also stated in `README.md`.
- [x] Code of conduct present: `CODE_OF_CONDUCT.md`.
- [x] Security policy present: `SECURITY.md`, with steps for reporting a vulnerability.
- [x] Security contact named in `SECURITY.md` and `CODE_OF_CONDUCT.md` (issue 1444 is closed).

## Run and test

- [x] README has run instructions: `npm ci`, `npm run build`, `npm test`, `npm start -w @gavel/server`.
- [ ] Tests run in GitHub Actions only. `README.md` still says to run `npm test` locally; the owner decides the wording.
- [x] Demo guide present: `docs/DEMO.md`. The hosted demo is not deployed yet.

## Secrets and payments

- [x] No secrets in history: the gitleaks-history workflow passed on `main`.
- [x] `.env.example` lists names only. Values are empty, except non-secret defaults (`PAYMENTS=fake`, `PAYPAL_ENV=sandbox`).
- [x] Evidence redacted: tokens, buyer emails and payer IDs in `docs/evidence/G1` and `docs/evidence/G4` are `[REDACTED]`.
- [x] Sandbox-only notice in `README.md` and `SECURITY.md`.
- [x] No live PayPal calls in code. Live hosts appear only in guard tests, specs and PayPal scope strings in the evidence.

## CI

- [ ] CI status green on `main`. The run for the latest commit was still in progress when this list was written. `README.md` has no CI badge.
- [x] Gitleaks history scan passes on `main`.

## Docs

- [x] Docs present: `docs/DECISIONS.md`, `docs/GATES.md`, `docs/DEMO.md`, `docs/PLAN.md`.

## Known limits

- [x] Gate G2 (card and guest AUTHORIZE) passed on the sandbox: PASS in `docs/GATES.md`.
- [x] Gate G3 (honor period, validity and reauthorize) is UNVERIFIED: NOT RUN in `docs/GATES.md`.
- [x] Gate G5 (speech-to-text accuracy on noisy bids) is UNVERIFIED: NOT RUN in `docs/GATES.md`.
- [x] Hosted demo and WebSocket room flow are not available yet (see `docs/DEMO.md`).
