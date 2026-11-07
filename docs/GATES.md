# Gates

A gate is CLOSED only when Status is PASS or FAIL with a recorded Decision. PARTIAL stays open.
A gate without evidence reads NOT RUN. PASS, PARTIAL and FAIL need an Evidence line.

## G0: sandbox app and buyer accounts

Status: PASS
Run date / by: 2026-11-04 by harshbhx (workflow gate-g0, run 41815593520, branch gate/g0)
Question: does the sandbox app authenticate, and can it create an AUTHORIZE order?
Setup: sandbox, the new business app (client id and secret as repository secrets, values never recorded), script `node scripts/gates/g0.mjs`.
Requests: client credentials token request, create order with intent AUTHORIZE.
Observed: token request HTTP 200 and the scopes include payments; create order HTTP 201 with order status CREATED and intent as sent; the approve link is present. The script printed `G0 PASS`.
Verdict: sandbox credentials work and the app can create an AUTHORIZE order.

| id                          | expected                 | actual                      | verdict  |
| --------------------------- | ------------------------ | --------------------------- | -------- |
| G0.1 token                  | HTTP 200, payments scope | HTTP 200, payments scope    | observed |
| G0.2 create AUTHORIZE order | HTTP 201 CREATED         | HTTP 201 CREATED, intent ok | observed |
| G0.3 approve link           | present                  | present                     | observed |

Decision: PASS
Fallback if FAIL: none for payments; hold G1 to G4 and demo on the fake PayPal.
Evidence: no evidence file is committed under docs/evidence/G0/ and the run published no artifact; the only record is the run log of workflow gate-g0, run 41815593520 (2026-11-04), which expires with the Actions log retention and is visible only with repository access. The run was made from branch gate/g0, before the main-only guard. Treat G0 as reported, not independently verifiable, until redacted evidence is committed.
Links: workflow gate-g0, run 41815593520; secrets by name below.
Scope: connectivity, token scopes and order creation only. No buyer approval or capture was part of G0.
Sandbox accounts: 1 business account that owns the app, and 5 personal buyer accounts, all US and USD. Buyer A, buyer B, buyer C (card), buyer D and buyer E use the emails gavel-buyer-a, gavel-buyer-b, gavel-buyer-card, gavel-buyer-d and gavel-buyer-e at personal.example.com. Passwords are not recorded in the repository.
Secrets (names only): the app is `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`; buyer credentials are the pairs `SANDBOX_BUYER`, `SANDBOX_BUYER2`, `SANDBOX_BUYER3` and `SANDBOX_CARD_BUYER`. The pair for buyer E (`SANDBOX_BUYER4`) is not set yet.

## G1: partial capture and remainder release

Status: PASS
Run date / by: 2026-11-04 by harshbhx (wallet); 2026-11-05 by harshbhx (card, run G1-20261105T123116Z)
Question: after authorize 500.00 and capture 350.00 with final_capture=true, is the 150.00 remainder released or still active?
Setup: sandbox, two buyers (script version 7e83b05 and run G1-20261105T123116Z, script version 3a1fe9c); every order in both runs is created with payment_source.paypal, so both are PayPal-account orders. The second buyer ("card") is a personal sandbox account named card, funded by a card; it is not a guest card checkout. No passwords or card numbers recorded.
Requests: create order (AUTHORIZE 500.00), buyer approval, authorize, capture 350.00 with final_capture, read the authorization and order, then an explicit void of the remainder.
Observed: after the final capture the authorization reads CAPTURED and the order COMPLETED for both buyers, so the remainder is released without a void. An explicit void afterwards answers HTTP 422 PREVIOUSLY_CAPTURED for both. The wallet capture accepted `invoice_id` and the order lists it on the capture.
Verdict: the authorization closes as CAPTURED and the order COMPLETED after the final capture, and a later void is refused with PREVIOUSLY_CAPTURED. That the 150.00 remainder is released is inferred from this and from PayPal's documentation; no run read a buyer balance or available funds (decision A). The authorization keeps amount 500.00, so the evidence cannot tell a released remainder from an open one.

| id                                               | expected             | actual                                                                         | verdict  |
| ------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------ | -------- |
| G1.5 wallet capture 350 with final_capture       | accepted             | HTTP 201 COMPLETED                                                             | observed |
| G1.6 wallet remainder status after final capture | open or released     | authorization CAPTURED, order COMPLETED (release inferred)                     | observed |
| G1.7 wallet explicit void of the remainder       | accepted or rejected | HTTP 422 UNPROCESSABLE_ENTITY PREVIOUSLY_CAPTURED, authorization then CAPTURED | observed |
| G1.8 wallet decision                             | A, B or C            | A                                                                              | observed |
| G1.5 card capture 350 with final_capture         | accepted             | HTTP 201 COMPLETED                                                             | observed |
| G1.6 card remainder status after final capture   | open or released     | authorization CAPTURED, order COMPLETED (release inferred)                     | observed |
| G1.7 card explicit void of the remainder         | accepted or rejected | HTTP 422 UNPROCESSABLE_ENTITY PREVIOUSLY_CAPTURED, authorization then CAPTURED | observed |
| G1.8 card decision                               | A, B or C            | A                                                                              | observed |

Decision: PASS (two PayPal-account buyers; remainder release inferred)
Fallback if FAIL: wallet buyers only, card path off (R-PAY-037).
Evidence: docs/evidence/G1/G1-20261104T231047Z.jsonl (sha256 8ac39be0454bcab5c7e2764d87d1d09566ac384681fc3e361285f78c70422bb8)
Evidence: docs/evidence/G1/G1-20261105T123116Z.jsonl (sha256 2c8ff2e139b0ecf66a1a273761ff8031f385f199f44dd0d2111cc54b10b7d4cb)
Links: spec tags flipped: R-PAY-059, R-PAY-051.
Scope: PayPal-account buyers only. Capture of a guest card order (the G2 guest AUTHORIZE) was never run on the sandbox.
Saga: a void refused with PREVIOUSLY_CAPTURED on the winner's remainder is treated as released (packages/payments/src/errorMap.ts, saga/remainder.ts).

## G2: card and guest AUTHORIZE

Status: PASS
Run date / by: 2026-11-05 by harshbhx (owner laptop, run G2-20261105T115228Z)
Question: does an Orders v2 intent AUTHORIZE flow work for card and guest checkout buyers in the sandbox?
Setup: sandbox, JS SDK v6 page served by the G2 script on localhost, script version g2-1 plus the fixes in this pull request; one US personal wallet buyer and one guest checkout with a Card Generator Visa (no passwords or card numbers recorded).
Requests: client token, create order (AUTHORIZE 500.00 USD) per path, buyer approval in the SDK v6 popup, authorize the order on the server.
Observed: the wallet session (`createPayPalOneTimePaymentSession`) and the guest card session (`createPayPalGuestOneTimePaymentSession` with the `paypal-basic-card-button`) both reached `onApprove`, and both authorize calls answered HTTP 201 COMPLETED with an authorization id. The first guest card attempt was cancelled at the card form (US card with a UK billing country) and a new order succeeded. The client token request with `domains[]=localhost` answers 401 `invalid_domain`; without `domains[]` it succeeds. `isEligible('basic_card')` throws "unsupported funding source"; guest card needs no eligibility key.
Verdict: card and guest AUTHORIZE work in SDK v6.

| id                  | expected                        | actual                                                                         | verdict |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------ | ------- |
| G2 wallet AUTHORIZE | order and authorization created | authorized, order 0TR888254R597950L, authorization 8BA74320N3059102T           | PASS    |
| G2 card AUTHORIZE   | order and authorization created | authorized, order 5G287943928656107, authorization 07P43249E7871404E           | PASS    |
| G2 rule             | PASS or PASS-WITH-FALLBACK      | card AUTHORIZE works in SDK v6: enable card in the UI (g2_card_authorize true) | PASS    |

Decision: PASS
Fallback if FAIL: restrict registration to wallet buyers.
Evidence: docs/evidence/G2/G2-20261105T115228Z.jsonl (sha256 2a0e9ee97fbecfa3419647a93bf39a77369be82c7a5e624827fe0e1ebcfffdfe)
Links: spec tags flipped: R-PAY-036, R-PAY-037. Flag: g2_card_authorize true.
Scope: AUTHORIZE only. Capture and void of the guest card authorization were not run; G1 (run G1-20261105T123116Z) captured a PayPal-account order only.

## G3: honor period versus validity and reauthorize

Status: NOT RUN
Run date / by: IN PROGRESS, real probe, day 0 was 7 Nov 2026 03:06 UTC (`.github/workflows/gate-g3.yml`; the earlier attempts on 4-7 Nov never ran, so no earlier day is claimed). Checkpoints at 3.5, 4 and 5 days; the final reading is about 12 Nov 06:17 UTC. Until those results exist the gate reads NOT RUN / IN PROGRESS.
Early evidence: Additional early reading (not the full 5-day result): two older G2 authorizations are probed by `gate-g3-early.yml` (PR #1929, not yet on main).
Simulated, not real: We simulated 30 days of auctions with a fake clock: holds, honor-period expiry, reauthorization, crashes and recovery, with the ledger balancing to the cent. This is a simulation, not a real sandbox result; PayPal's 29-day validity was not verified in the real sandbox. Details: [docs/evidence/SIM/SIM-MULTIDAY.md](evidence/SIM/SIM-MULTIDAY.md).
Question: how long does an authorization stay capturable, and does reauthorize extend it?
Setup: n/a
Requests: n/a
Observed: n/a
Verdict: n/a
Decision: n/a
Fallback if FAIL: keep auctions shorter than the validity window and reauthorize before hammer.
Links: n/a

## G4: real webhook signature verification

Status: PASS
Run date / by: 2026-11-05 by harshbhx (workflow gate-g4, run 41947655945)
Question: does signature verification against the sandbox webhook id accept real events and reject tampered ones?
Setup: sandbox, the new app's webhook id, script version 7604ec8, no buyer credentials recorded.
Requests: create and approve orders, authorize, capture 1.00 with final_capture, void a second authorization; collect the real deliveries and send each, as received, to POST /v1/notifications/verify-webhook-signature.
Observed: 6 real deliveries (CHECKOUT.ORDER.APPROVED x2, PAYMENT.AUTHORIZATION.CREATED x2, PAYMENT.CAPTURE.COMPLETED, PAYMENT.AUTHORIZATION.VOIDED) each answered HTTP 200 with verification_status SUCCESS. The log holds a capture and a void event. Six sanitized fixtures are committed. Real events carry fields the fake simulator lacked (event_version, resource_type, resource_version, summary, links); real resources also carry amount, create_time, custom_id, expiration_time, links, payee, seller_protection, status, supplementary_data and update_time (capture: final_capture, disbursement_mode, seller_receivable_breakdown). The simulator-only fields are orderId, authId, captureId, amountCents and reason.
Verdict: real events verify through PayPal's endpoint with the raw body spliced into the request.

| id                                    | expected          | actual                              | verdict  |
| ------------------------------------- | ----------------- | ----------------------------------- | -------- |
| G4.1 verify CHECKOUT.ORDER.APPROVED   | SUCCESS (2 of 2)  | SUCCESS, SUCCESS                    | observed |
| G4.1 verify AUTHORIZATION.CREATED     | SUCCESS (2 of 2)  | SUCCESS, SUCCESS                    | observed |
| G4.1 verify PAYMENT.CAPTURE.COMPLETED | SUCCESS           | SUCCESS                             | observed |
| G4.1 verify AUTHORIZATION.VOIDED      | SUCCESS           | SUCCESS                             | observed |
| G4.2 sanitized fixtures               | written           | 6 files in test/fixtures/webhooks   | observed |
| G4.3 shape against the simulator      | differences noted | extra top-level and resource fields | observed |
| G4.4 log holds capture and void       | both present      | both present                        | observed |

Decision: PASS
Fallback if FAIL: confirm event state by fetching the resource from the API before acting on it.
Evidence: docs/evidence/G4/G4-20261105T012205Z.jsonl (sha256 6ce8f1d325266cc780dd74becfd07e58fcf545444c759de1eaecd5766aa5050c)
Links: spec tags flipped: R-PAY-146, T-PAY-093. Fixtures: packages/payments/test/fixtures/webhooks/.
Scope: tampered-event rejection was not part of this run; it is covered against the fake only. Retry schedule and PAYMENT.CAPTURE.DENIED/PENDING shapes stay UNVERIFIED. Only first deliveries were recorded, so whether a PayPal retry keeps the original PAYPAL-TRANSMISSION-ID and -TIME is UNVERIFIED too (ASSUMPTIONS W06); until a run records a retry, the verifier sends an old transmission time within seven days to the verify endpoint instead of refusing it (D-0033).

## G5: STT accuracy on noisy bids

Status: FAIL
Run date / by: 2026-11-07, cached eval over recorded provider outputs (PR #1940, issue #1864)
Question: is the speech-to-text accuracy on noisy bid audio high enough to accept bids without manual confirmation?
Setup: synthetic eSpeak speech (noise-free and robotic, which is harder than real speech), 24 clips, scored by the cached eval: Deepgram nova-2 exact 0.615, wrong-accept 0.125, confirm 0.417; Groq whisper-large-v3-turbo exact 0.615, wrong-accept 0.083, confirm 0.375..
Requests: the 24 clips were sent to each provider once and the outputs were recorded; the cached eval scores the recorded outputs through the rule parser.
Observed: Deepgram nova-2 exact 0.615, wrong-accept 0.125, confirm 0.417. Groq whisper-large-v3-turbo exact 0.615, wrong-accept 0.083, confirm 0.375.
Verdict: both providers miss the threshold (wrong-accept 0.05 or less), on speech that is noise-free but robotic and so harder than real speech. There is no real-room or noisy-room test.
Decision: FAIL for unconfirmed voice bids: spoken bids always go through the confirm prompt (assist mode). The payments decision is unchanged.
Fallback if FAIL: always show the confirm prompt for spoken bids.
Evidence: PR #1940 (24 synthetic clips and the recorded provider outputs; the files are on main once it merges)
Links: issue #1864

### G5-text: text-level run (step 1)

Run by the voice-eval workflow, text mode (transcripts through the parser, no audio, no provider,
no keys), commit 5d2e253, artifact `voice-eval-text`. Reference text goes in as recognized text, so
this measures the parser only. It says nothing about speech-to-text accuracy.

| set      | n   | bid | none | exact | wrong accept | confirm | recoverable | missed bid | false prompt |
| -------- | --- | --- | ---- | ----- | ------------ | ------- | ----------- | ---------- | ------------ |
| dev      | 129 | 77  | 19   | 0.948 | 0.000        | 0.264   | 0.052       | 0.000      | 0.000        |
| held-out | 40  | 22  | 9    | 0.864 | 0.000        | 0.300   | 0.136       | 0.000      | 0.000        |
| all      | 169 | 99  | 28   | 0.929 | 0.000        | 0.272   | 0.071       | 0.000      | 0.000        |

The 169 cases cover 23 categories. Exact counts bids accepted with the right bidder and amount;
cases whose expected outcome is confirm or none are not in the exact count, which is why
categories made only of those show 0.000. The held-out set was not used to change the lexicon or
thresholds.

Per category (n, exact, wrong accept, confirm) for dev and held-out:

| category         | dev n | dev exact | dev confirm | held-out n | held-out exact | held-out confirm |
| ---------------- | ----- | --------- | ----------- | ---------- | -------------- | ---------------- |
| ambiguous        | 6     | 0.000     | 1.000       | 2          | 0.000          | 1.000            |
| asr_error        | 12    | 1.000     | 0.083       | 4          | 1.000          | 0.000            |
| asr_prep         | 3     | 0.500     | 0.667       | 1          | 0.000          | 1.000            |
| auctioneer       | 2     | 0.000     | 0.000       | 0          | n/a            | n/a              |
| cents_digits     | 3     | 0.000     | 1.000       | 1          | 0.000          | 1.000            |
| colloquial       | 9     | 1.000     | 0.000       | 3          | 1.000          | 0.000            |
| correction       | 5     | 0.000     | 0.400       | 1          | 0.000          | 1.000            |
| currency         | 4     | 1.000     | 0.000       | 1          | 1.000          | 0.000            |
| extended_numbers | 10    | 1.000     | 0.000       | 2          | 1.000          | 0.000            |
| hedged           | 3     | 0.000     | 1.000       | 1          | 0.000          | 1.000            |
| homophone        | 7     | 1.000     | 0.429       | 2          | 1.000          | 0.500            |
| indian_english   | 4     | 0.500     | 0.500       | 1          | 0.000          | 1.000            |
| injection        | 3     | 0.000     | 0.000       | 1          | 0.000          | 0.000            |
| make_it          | 5     | 1.000     | 0.400       | 1          | 0.000          | 1.000            |
| multi            | 3     | 0.000     | 1.000       | 0          | n/a            | n/a              |
| negation         | 3     | 0.000     | 0.000       | 1          | 0.000          | 0.000            |
| non_bid          | 8     | 0.000     | 0.000       | 6          | 0.000          | 0.000            |
| numeral          | 9     | 1.000     | 0.000       | 3          | 1.000          | 0.000            |
| paddle           | 8     | 1.000     | 0.125       | 3          | 1.000          | 0.000            |
| plain            | 13    | 1.000     | 0.000       | 3          | 0.667          | 0.333            |
| question         | 3     | 0.000     | 0.000       | 1          | 0.000          | 0.000            |
| teen_ty          | 2     | 0.000     | 1.000       | 1          | 0.000          | 1.000            |
| two_bidders      | 4     | 0.000     | 1.000       | 0          | n/a            | n/a              |

Wrong accept is 0.000 in every category. The AUTO threshold sweep (0.70 to 0.95) is flat at the
text level, because the parser emits only a few confidence values (0.50, 0.95, 1.00).

Not measured: audio, speech-to-text error, latency (text mode reports 0 ms), the cached and live
modes (no recorded provider output is in the repo, no live run was done), and the AUTO and CONFIRM
threshold calibration of issue 478. The G5 status above comes from the synthetic eSpeak run (PR #1940); there is no real-room or noisy-room run.

### G5 threshold calibration (issue 478)

Decision: keep the defaults AUTO 0.85 and CONFIRM 0.50 (`defaultConfig`, R-VOX-063). Rationale: the
text-level sweep above is flat from 0.70 to 0.95 (the parser emits only 0.50, 0.95 and 1.00), wrong
accepts are 0.000 on the dev and held-out sets, and the confirm rate is 0.272. No audio sweep exists
yet because no live provider run was done, so the audio set cannot move the thresholds either way.
The held-out text set was not used. Revisit after the live run: if any wrong accept shows up on the
audio set, raise AUTO to the lowest sweep value with zero wrong accepts.

Live run (not in pull request CI): `npm run gate:g5 -w @gavel/e2e -- --write-gates` sends 20 noisy
recorded bids (`G5_AUDIO_DIR/g5-01.wav` to `g5-20.wav`, supplied privately) to the live provider
(`DEEPGRAM_API_KEY`) and then to the rule parser, and fills this section and a `G5-live` table. It
prints `skipped` when the key or a recording is missing. The nightly workflow
`.github/workflows/nightly-sandbox.yml` calls it too. Verdict: PASS needs exact plus recoverable
confirm at 0.90 or more and wrong accepts at 0.05 or less; PARTIAL needs 0.70 or more; otherwise FAIL.

## Decision

Interim decision: GO, with documented fallbacks. This is not a final go: G3 is IN PROGRESS and G5 FAILED on synthetic speech, so voice bids use the confirm prompt.

Verified, with evidence above:

- Wallet and card AUTHORIZE work (G2), so the card and guest path is on (`g2_card_authorize` true).
- Partial capture with `final_capture` closes the authorization as CAPTURED for two PayPal-account buyers (G1, decision A); that the remainder is released is inferred, not observed.
- Real webhooks verify through PayPal's endpoint (G4). Tampered-event rejection is covered against the fake only.
- The sandbox app and buyer accounts work (G0; Actions run log only, no committed evidence file).

Not run, results pending:

- G3 (honor period, validity and reauthorize): NOT RUN / IN PROGRESS (day 0 7 Nov 2026 03:06 UTC, final about 12 Nov 06:17 UTC). Fallback: capture within the verified validity window and use the reauthorize path (spec R3, T-QA-052) before hammer. R3 is the plan, not a result: it is not verified until G3 runs.
- G5 (speech-to-text accuracy on noisy bids): FAIL on synthetic eSpeak speech, 24 clips (Deepgram nova-2 wrong-accept 0.125, Groq whisper-large-v3-turbo 0.083, threshold 0.05). Fallback: voice bids always go through the confirm prompt (assist mode). No real-room or noisy-room test.

What changes the decision:

- G3 shows a validity window shorter than the longest planned auction, or reauthorize does not extend it: auctions are capped to the validity window and the demo stays short, or the decision moves to NO-GO for long auctions.
- G3 passes with a window that covers the planned auctions: the decision becomes GO for card and wallet.
- G5 FAIL (the current state): voice bids stay behind the confirm prompt; the payments decision is unchanged.
- A later run of G1, G2 or G4 that no longer matches the recorded evidence reopens that gate and the flag that depends on it.

## Latency targets and measured numbers

Targets (R-PAY-152) against the sandbox measurement. Date: 2026-11-05. Workflow: `measure-sandbox`, run 42047543821 (https://github.com/harshbhx/gavel-auction/actions/runs/42047543821). Real PayPal sandbox, 10 sequential cycles, 0 failures, so n=10 per call. The raw evidence is not committed; the run log is the only record and it expires with the Actions log retention. These numbers are not independently verifiable until a redacted log is committed.

| Call      | p50 (ms) | p95 (ms) | max (ms) |
| --------- | -------- | -------- | -------- |
| order     | 650.88   | 758.5    | 758.5    |
| authorize | 1299.04  | 2268.65  | 2268.65  |
| capture   | 1871.69  | 2280.66  | 2280.66  |
| void      | 939.76   | 1235.96  | 1235.96  |

Earlier, the same script ran against the fake PayPal (`npm run measure -- --fake`, 2026-11-04, 50 sequential and 10 parallel cycles). Those numbers were our client overhead on loopback, not PayPal latency, and they do not count as a sandbox measurement.

| Target                                   | Value  | Measured (sandbox, n=10)                                                                                 | Status                                          |
| ---------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| hammer to CAPTURED p95                   | 2.5 s  | capture p95 2280.66 ms (the same capture mapping the fake table used; with n=10 p95 is close to the max) | UNVERIFIED end to end (capture call only, n=10) |
| hammer to SETTLED, 6 holds, p95          | 6 s    | void p95 1235.96 ms; the truth check that settlement also needs is not measured by this script           | UNVERIFIED (G1 measurement)                     |
| webhook handler 200, without verify call | 300 ms | not part of this script (covered by T-PAY-068)                                                           | UNVERIFIED (G1 measurement)                     |

Staging security tests and load tests stay UNVERIFIED until the Render URL exists. The judge smoke test has not run against a live site.

Fallback: where a target is not met on sandbox numbers, the target is raised to the sandbox p95 (a decision for the owner; targets are not raised automatically). The 2.5 s target covers hammer to CAPTURED (truth check, journal writes and capture); only the capture call was measured, in 10 samples where p95 equals the max, so the CAPTURED target is not shown to be met end to end. It needs an end-to-end saga measurement with at least 30 samples. The SETTLED target is not shown to hold: the budget below assumes each call stays under 1 s at p95, and sandbox void p95 is 1235.96 ms, so that assumption fails. The fallback therefore applies to SETTLED, and its target must be raised to the sandbox-based value (a decision for the owner, after the truth-check latency is measured). The saga defaults below are not changed by this record.

Rate limit: 0 answers with 429 and no `Retry-After` header in 60 cycles against the fake. The real limits are UNVERIFIED (G1 measurement).

Budget with sandbox numbers: a settlement of 6 holds is one truth check, one capture and 5 voids. With 3 voids at a time that is two void waves. Using sandbox p95 for the capture and void calls alone gives 2 x 1235.96 + 2280.66 = 4752.58 ms, before the truth check, which is not measured yet. The 6 s target is not shown to hold with margin on sandbox numbers.

Saga defaults (`SAGA_DEFAULTS` in `packages/payments/src/config.ts`, equal to the constants in the saga):

| Setting           | Value  | Reason                                                                                                                              |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| voidConcurrency   | 3      | two waves for 5 voids; the parallel run shows 10 concurrent calls cost 6 to 20 times one call, so a small bound keeps the tail down |
| maxVoidResumes    | 5      | a void that fails five resumes goes to review instead of looping                                                                    |
| unknownDeadlineMs | 600000 | ten minutes for an unknown capture outcome before review (R-PAY-053)                                                                |

## Real-sandbox nightly run 42200708552 (2026-11-06)

Run: https://github.com/harshbhx/gavel-auction/actions/runs/42200708552 (workflow `nightly-sandbox`, `workflow_dispatch`, branch `main`, head 697215148be6, started 2026-11-06 10:11 UTC).
Question: what did the nightly sandbox job show against the real PayPal sandbox, spec by spec?
Setup: sandbox, all four sandbox secrets present (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD`), plus the `SANDBOX_BUYER2`, `SANDBOX_BUYER3` and `SANDBOX_CARD_BUYER` pairs. Values are masked in the log and not recorded here. `GAVEL_STAGING_URL` and `GAVEL_STAGING_ADMIN_KEY` were empty.
Result: the `nightly` job concluded success, but the report the job wrote (`report/sandbox.json`, artifact `sandbox-report`, artifact id 13493479420) says overall `inconclusive`: pass 7, fail 0, inconclusive 1, skipped 2. Vitest reported 8 tests passed and 1 skipped (9 tests in 4 files). A green job does not mean every spec passed; the table is the record.

| spec                                  | gate | vitest     | report status | observed                                                                                          |
| ------------------------------------- | ---- | ---------- | ------------- | ------------------------------------------------------------------------------------------------- |
| R1 partial capture and remainder      | G1   | pass       | pass          | captured 35000 cents, remainder released (spec's own wording; see G1)                             |
| R2 card or guest authorize            | G2   | pass       | pass          | card buyer, authorization CREATED (authorize only; no capture)                                    |
| R3 reauthorize after a delay          | G3   | pass       | inconclusive  | reauthorize answered HTTP 422 UNPROCESSABLE_ENTITY; G3 stays NOT RUN                              |
| R4 staging restart                    | G4   | skipped    | skipped       | no staging host configured (`GAVEL_STAGING_URL`)                                                  |
| R5 idempotent capture                 | G1   | pass       | pass          | second send answered 200 with the same capture                                                    |
| R6 void each non-winner once          | G1   | pass       | pass          | both voids accepted; a repeat void on the same authorization answered 422 PREVIOUSLY_VOIDED       |
| R7 full lot                           | G1   | pass       | pass          | saga SETTLED; ledger against PayPal 0 differences; winner captured 12500 cents                    |
| R8 reconciliation                     | G1   | pass       | pass          | reconciliation 0 differences; winner captured 12500 cents                                         |
| R9 three buyers                       | G1   | pass       | not in report | winner captured, runner-up and loser released (vitest only; no R9 entry in `report/sandbox.json`) |
| R10 crash between capture and journal | G1   | pass       | pass          | one crash, one capture on the winner, losers voided                                               |
| G5 speech harness                     | none | not a spec | skipped       | 20 of 20 recordings missing for deepgram and for groq; G5 stays NOT RUN                           |

What this run changes: nothing in the status blocks above. It adds sandbox evidence for R1, R5 to R8 and R10 (partial capture, idempotent capture, void, saga settlement, reconciliation, crash resume), all on PayPal-account orders and the sandbox. R10 has now passed once in the nightly run, which is the condition the crash section sets for the repeated-capture tag; the tag itself is not changed here.

What this run does not prove:

- G1: the remainder release is still inferred, not read from a buyer balance (decision A stands as written).
- G2: no guest or card capture and no void of a card authorization ran; R2 stops at CREATED.
- G3: no honor-period or validity-window result; those results are still pending (planned 8 and 9 November). R3 answered 422, so reauthorize is unproven on this run.
- G4 staging: R4 was skipped, so the real server kill after capture did not run. R10 is the in-process crash only.
- G5: no audio ran, so no speech-to-text accuracy exists.
- R9 is not in the report counts; its pass comes from vitest output only.
- Latency: this run recorded no timings for the targets, so the table above is unchanged. The void p95 caveat stands: 1235.96 ms against the 1000 ms budget, and the SETTLED budget assumption (each call under 1 s at p95) still fails.
- Only the run log and the summary artifact exist; no redacted evidence file is committed, so the figures are reported, not independently verifiable, until one is.

Decision: no change. G1 PASS (decision A), G2 PASS, G3 NOT RUN / IN PROGRESS, G5 FAIL on synthetic speech (confirm prompt kept).

## Run entries

`gates/summarize.ts` in `packages/payments` appends one entry per gate run below this line in the format of SPEC 7.2 (operator, date, script sha, buyer kinds without credentials, observed rows, evidence path with its sha256, decision, fallback adopted, spec tags flipped). The status blocks above change only after the matching entry exists.

## Sandbox environment (required before any gate runs)

The gate workflows (`.github/workflows/gate-g0.yml`, `gate-g1.yml`, `gate-g3.yml` and
`gate-g4.yml`) declare `environment: sandbox-nightly` and their jobs only run from `main`. Today the environment
exists but has no reviewer, no branch rule and no secrets, and the PayPal sandbox secrets are
repository-level, so a workflow on any pushed branch can read them (issue 1597). Keep only
throwaway sandbox values in them. To close that gap the repository owner must set the
environment up once:

1. Settings, Environments, New environment, name `sandbox-nightly`.
2. Add a required reviewer and limit deployment branches to `main`.
3. Add these four secrets to the environment: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
   `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD`.
4. Delete the repository-level copies of the same four secrets, so a workflow on any other branch
   cannot read them.

The nightly workflow `.github/workflows/nightly-sandbox.yml` uses the same environment. It runs
every spec file in `packages/e2e/sandbox` through `npm run test:sandbox` (R1 to R4, R5 to R8, R9 and R10)
at 20:30 UTC and on manual dispatch. R9 is skipped unless the second and third sandbox buyer secrets
(`SANDBOX_BUYER2_*` and `SANDBOX_BUYER3_*`) are also set. The same job then runs the G5 speech harness
(`npm run gate:g5`), which skips each provider whose key or audio recordings are missing; G5 stays NOT RUN
until a real run exists. The job then writes `report/sandbox.json` with one of pass, fail, inconclusive or skipped per spec. Without the
secrets every spec is skipped and the run is green, so a green nightly run alone does not show that any sandbox spec ran: read `report/sandbox.json`. Only the summary is uploaded (14 days); the
transcripts stay on the runner. A spec whose gate is still open reports `inconclusive`, not `fail`.

`packages/payments/src/gates-result.json` flags (`g1_remainder_mode`, `g2_card_authorize`,
`g4_webhooks_verified`) may leave their safe value only while the matching section above is
closed with an Evidence line; `test/gates/gatesResultEvidence.test.ts` fails otherwise, and also
when the evidence file no longer matches its recorded sha256.

The sandbox accounts must be US accounts. PayPal rejects INR orders for the sandbox buyers with `422 CURRENCY_NOT_SUPPORTED`, and India sandbox buyers fail at the buyer approval page with USD. Gates send USD by default; set `GATE_CURRENCY` only to override it for a specific run.

Until the environment exists, GitHub creates it on first use with no reviewer and no branch rule,
so do not run a gate before step 2 is done. The gate workflows run only from `main`. G0, G1 and G4 are manual; `gate-g3.yml` also runs on a schedule (every 6 hours) because it is a timed probe, so it uses the sandbox secrets without a manual trigger. CI is not affected in the meantime.

## Crash between capture and journal save (T-PAY-094, R-PAY-060)

`packages/e2e/sandbox/r10.spec.ts` (R10, gate G1) runs in the nightly sandbox job with the same four
secrets as R1 to R8. The real settlement saga and PayPal gateway settle a lot of three holds, the
first run dies at the `after:capture` boundary (capture answered, journal not saved), a second run
resumes from the journal. The spec checks one capture on the winner for the hammer price, the
same request id on every capture call, losers voided and a journal that matches PayPal. A failed
expectation leaves no result file, which the report counts as fail.

Not covered without staging: killing a real server process with `GAVEL_CHECKPOINT_KILL=after_capture_request_before_response`
on a deployed host. That needs `GAVEL_STAGING_URL` and `GAVEL_STAGING_ADMIN_KEY`, a staging server
that is allowed to start with the hook (it is refused when `NODE_ENV=production`) and a way to
restart it on the same store. Until the owner provides that, the in-process crash in R10 is the
evidence, and the SPEC tag for PayPal's repeated-capture answer stays UNVERIFIED until R10 has
passed once in the nightly run.

Status of crash safety: whole-auction settlement and crash recovery are verified against the fake PayPal only. No whole-auction settlement ran on the real sandbox, R10 stays UNVERIFIED until it has passed once, and G3 (authorization validity and reauthorize) is NOT RUN / IN PROGRESS, so holds in an auction longer than minutes may expire before capture.
