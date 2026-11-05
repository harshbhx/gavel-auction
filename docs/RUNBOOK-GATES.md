# Gate failure runbook

What to do when a payment or voice gate fails, stays NOT RUN, or reads stale. The gate questions,
results and fallbacks live in `docs/GATES.md`; this page says where to look, what to decide, who
acts and what to re-run. It holds names only: no secret values, logins or buyer credentials.

## Roles

- Owner: the repository owner (harshbhx). Only the owner can approve the `sandbox-nightly`
  environment, read or change its secrets, use the PayPal developer dashboard and run anything
  against the real sandbox from a laptop.
- Contributor: anyone else. A contributor reads evidence files and workflow logs, runs the fake
  PayPal and the text-level voice eval, and opens pull requests. A contributor never receives
  secrets and never runs a gate against the real sandbox.

## Common rules

- A gate closes only with Status PASS or FAIL, a Decision and an Evidence line (`docs/GATES.md`).
  PARTIAL stays open, and a gate without evidence reads NOT RUN.
- Gate workflows declare `environment: sandbox-nightly` and run only from `main`. If a run waits
  forever or fails at the environment step, the environment or its reviewer is missing: owner
  action (see "Sandbox environment" in `docs/GATES.md`).
- The four repository-level Actions secrets (not yet moved into an environment, see issue 1597)
  are `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `SANDBOX_BUYER_EMAIL` and
  `SANDBOX_BUYER_PASSWORD`. A missing or expired one shows as an auth
  error or a skipped spec. The owner rotates it in the environment settings; never paste a value
  into an issue, a log or a pull request.
- Gate flags in `packages/payments/src/gates-result.json` may leave their safe value only while
  the matching section in `docs/GATES.md` is closed with evidence. A test fails otherwise.
- Sandbox accounts must be US accounts and gates send USD. `422 CURRENCY_NOT_SUPPORTED` means the
  account or currency is wrong, not that PayPal is down.
- The hosted demo is in production mode and refuses fake payments. The fake PayPal runs locally
  or in CI only.

## Evidence and where to look (all gates)

- Evidence files: `docs/evidence/<gate>/` (G1 and G4 hold one today), each named in the gate's
  Evidence line with its sha256. A mismatch between file and recorded sha256 fails
  `test/gates/gatesResultEvidence.test.ts`.
- Workflow runs: the Actions tab, workflow named `gate-g0`, `gate-g1`, `gate-g3` or `gate-g4`,
  plus `nightly-sandbox` for specs R1 to R8 (`report/sandbox.json`: pass, fail, inconclusive or
  skipped; a spec whose gate is open reports inconclusive).
- Read a run: `gh run list --workflow gate-g1 --limit 5`, then `gh run view <run-id> --log-failed`.
- PayPal developer dashboard (owner only), by section name: Apps and Credentials (sandbox app),
  Sandbox accounts, Webhooks (webhook id and recent deliveries), API call logs (Dashboard,
  Logs).

## Re-run commands

Owner, from the Actions tab or the CLI (each is `workflow_dispatch`, main only):

- `gh workflow run gate-g0 --ref main`
- `gh workflow run gate-g1 --ref main`
- `gh workflow run gate-g3 --ref main` (also scheduled every 6 hours)
- `gh workflow run gate-g4 --ref main` (needs the repository variable `G4_RECEIVER_URL`, an https
  URL with no trailing slash)
- `gh workflow run nightly-sandbox --ref main`

There is no `gate-g2` workflow. G2 runs on the owner laptop only, with sandbox credentials in the
shell environment (names as above, plus the card buyer variables the script asks for):

- `PAYPAL_ENV=sandbox npm run gate:g2 -w @gavel/payments`

Package scripts behind the workflows (`packages/payments`): `gate:g0`, `gate:g1`, `gate:g3`,
`gate:g4`, `gate:g4-events`, `gate:idem`. Voice (`packages/e2e`):
`npm run gate:g5 -w @gavel/e2e -- --write-gates`. Do not run these on the shared 2-CPU VM; use the
workflows or the owner laptop.

After any run, commit the new evidence file and the updated `docs/GATES.md` section on a branch
and open a pull request. Do not edit a gate to PASS by hand.

## G0: sandbox connectivity and credentials

- Failure signals: `gate-g0` red; auth errors (401) on token request; no G0 evidence file.
  `docs/GATES.md` has no G0 section today, so G0 results are the run log and any file under
  `docs/evidence/G0/`.
- Check: the `gate-g0` run log; Apps and Credentials in the PayPal dashboard (app exists, mode is
  sandbox); the four repository secrets exist.
- Fallback decision: none for payments. Without G0 no later real-sandbox gate is meaningful, so
  hold G1 to G4 and demo on the fake PayPal (see "Demo fallback").
- Who acts: owner (secrets, dashboard, approving the environment). Contributor reads the log and
  reports the error text without values.
- Re-run: `gh workflow run gate-g0 --ref main`.

## G1: partial capture and remainder release

- Failure signals: `gate-g1` red; the remainder reads still active after a final capture; the
  explicit void answers anything other than accepted or `422 PREVIOUSLY_CAPTURED`; evidence sha256
  mismatch.
- Check: `docs/evidence/G1/` file named in the Evidence line; the `gate-g1` log; Sandbox accounts
  (wallet buyer present) and API call logs in the dashboard; saga handling in
  `packages/payments/src/errorMap.ts` and `saga/remainder.ts`.
- Fallback decision: wallet buyers only, card untested (R-PAY-037). If the remainder is not
  released, keep `g1_remainder_mode` at its safe value and void the remainder explicitly in the
  saga.
- Who acts: owner re-runs and records the Decision; contributor adjusts saga code in a pull
  request once the owner records the observed behaviour.
- Re-run: `gh workflow run gate-g1 --ref main`.

## G2: card and guest AUTHORIZE

- Failure signals: status NOT RUN or FAIL; the Orders v2 AUTHORIZE flow is rejected for a card or
  guest buyer; `g2_card_authorize` still at its safe value.
- Check: Sandbox accounts (a card or guest-capable US buyer), API call logs, the owner-laptop
  output of the G2 script.
- Fallback decision: restrict registration to wallet buyers (the G2 fallback line). On the demo,
  say that only PayPal wallet sandbox buyers are offered; the demo guide already states this.
- Who acts: owner only (needs sandbox credentials and a browser session on the laptop).
- Re-run: `PAYPAL_ENV=sandbox npm run gate:g2 -w @gavel/payments` on the owner laptop. G2 stays
  open until a recorded Evidence line exists.

## G3: honor period versus validity and reauthorize

- Failure signals: `gate-g3` red or stuck between its resume steps; the authorization expires
  earlier than the planned auction length; reauthorize does not extend it; NOT RUN.
- Check: the `gate-g3` log and its uploaded state; API call logs; `GAVEL_HOLD_MAX_AGE_MS` and
  the timing note in `docs/DEMO.md`.
- Fallback decision: keep auctions shorter than the validity window and reauthorize before hammer
  (the G3 fallback line). A hold older than the limit is flagged stale but still captured.
- Who acts: owner re-runs and records the Decision; contributor changes auction length defaults.
- Re-run: `gh workflow run gate-g3 --ref main`. Its resume step continues a run that is part way.

## G4: real webhook signature verification

- Failure signals: `gate-g4` red; any delivery answers a `verification_status` other than SUCCESS;
  no deliveries arrive; `G4_RECEIVER_URL` unset; `g4_webhooks_verified` unflipped.
- Check: `docs/evidence/G4/` file; the `gate-g4` log; Webhooks in the PayPal dashboard (webhook
  id matches the one the run uses, recent deliveries listed); the receiver variable.
- Fallback decision: confirm event state by fetching the resource from the API before acting on
  it (the G4 fallback line). Tampered-event rejection is covered against the fake only.
- Who acts: owner (webhook id, receiver variable, dashboard). Contributor may add fixtures under
  `packages/payments/test/fixtures/webhooks/` from an owner-approved run.
- Re-run: `gh workflow run gate-g4 --ref main`. Event capture alone: `gate:g4-events`.

## G5: STT accuracy on noisy bids

- Failure signals: exact plus recoverable confirm under 0.90 or wrong accepts above 0.05 (PARTIAL
  needs 0.70; below that FAIL); the live run prints `skipped` (key or recordings missing);
  `voice-eval` red.
- Check: the `voice-eval` run summary and the `voice-eval-text` artifact (parser only, says
  nothing about speech-to-text); the G5-text and G5-live tables in `docs/GATES.md`.
- Fallback decision: always show the confirm prompt for spoken bids. For the demo use voice
  replay (`/replay/:recordingId`, recorded audio with captions); live voice needs speech provider
  keys on the server and is not available yet.
- Who acts: owner for the live run (`DEEPGRAM_API_KEY` and the private `G5_AUDIO_DIR` recordings);
  contributor for parser and lexicon changes, checked with the text-level eval.
- Re-run: the `voice-eval` workflow on a pull request; live:
  `npm run gate:g5 -w @gavel/e2e -- --write-gates` on the owner laptop.

## Demo fallback when a gate cannot close in time

Pick the first line that applies and say it out loud on the page or in the pitch:

1. Real sandbox works for wallet buyers: run a live sandbox room, wallet buyers only (G1 PASS,
   G2 open).
2. No sandbox buyer or the sandbox is down: recorded replay at `/replay/:recordingId`. It makes
   no PayPal calls and needs no login.
3. Local only: the scripted demo launcher with the fake PayPal ("Scripted demo: recorded events,
   no PayPal calls"). It is refused by the hosted server in production mode.

Never present fake or replayed results as a gate pass. Every page keeps its mode label.
