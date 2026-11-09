# Gates

A gate is CLOSED only when Status is PASS or FAIL with a recorded Decision. PARTIAL stays open.
A gate without evidence reads NOT RUN. PASS, PARTIAL and FAIL need an Evidence line.

## Summary: what is proven

- G0, G1, G2 and G4 are PASS on the real PayPal sandbox (app and buyers, partial capture with `final_capture`, wallet and guest card AUTHORIZE, six real webhooks verified).
- A real server process kill on a CI runner against the sandbox settled with one capture, two losers voided, a journal equal to PayPal and a verifying ledger of 19 entries (run 42558021614).
- Live speech through the `/audio` socket: both providers answered 24 of 24 synthetic clips with no spoken bid accepted without a confirm (run 42575018866).
- Hosted API: webhook route p95 112.03 ms (n=50, runner network included) against a 300 ms target, warmup after 16 minutes idle at most 0.66 s (n=2), security headers on the custom domains.
- G5 is PARTIAL (synthetic audio, next step a real room) and G3 is IN PROGRESS (final reading about 12 Nov 06:17 UTC). Latency is measured at SETTLED p95 6927.43 ms against 6000 ms and CAPTURED p95 3766.67 ms against 2500 ms (run 42563147792, 49 of 50 completed, INCOMPLETE); the owner decision on the targets is open. Scope and detail are in the sections below.

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
Evidence: docs/evidence/G0/G0-20261109T031839Z.jsonl (sha256 c85c66f3b2f016fae3f4105288fb4b35a59891572111cba3c8312dc757a8b073)
Re-run: workflow gate-g0 dispatched from main on 2026-11-09 03:17 UTC, run 42555610707 (https://github.com/harshbhx/gavel-auction/actions/runs/42555610707), script version 710163d: token HTTP 200, order HTTP 201 CREATED, approve link present, intent AUTHORIZE read back, all assertions pass. The file is the redacted request and response log (tokens, app id, nonce and headers are [REDACTED]); it holds one order id. The original record is run 41815593520 (2026-11-04, branch gate/g0, before the main-only guard); its log expires and is not the evidence.
Links: workflow gate-g0, runs 41815593520 (2026-11-04) and 42555610707 (2026-11-09); secrets by name below.
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
Observation attempt (run 42567836032, https://github.com/harshbhx/gavel-auction/actions/runs/42567836032, workflow `gate-g1-observe`, 9 Nov 2026): result inferred. The buyer account pages asked for a sign-in again, so no buyer-view reading (available funds or pending activity) was possible at any step. The API-side readings did happen: before authorize the order was APPROVED; after authorize the order was COMPLETED and the authorization CREATED; after the 350.00 capture of the 500.00 authorization (HTTP 201) the order was COMPLETED and the authorization CAPTURED. Evidence: g1-observe-261109053243.json (sha256 29a0307ce8a2a90a44ffdb7f5532b4592aa39e138c40af2d13dd6ce91e3b022d) and g1-observe-261109053243.md (sha256 84d9d5202bc40d5c11528f5695b4f8b7ef39da807779cf78a5fed11aff288953) under docs/evidence/G1/. No available-funds number exists, so the release stays inferred.
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
Scope: PayPal-account buyers only. No final_capture and no 350.00 hammer capture was run on a guest card order. A later early G3 probe accepted a partial capture of 1.00 on the guest card authorization (see G3 and docs/evidence/G3-early/); it does not change the G1 verdict or scope.
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
Scope: AUTHORIZE only. Void of the guest card authorization and a `final_capture` on it were not run; G1 (run G1-20261105T123116Z) captured a PayPal-account order only. Later, the early G3 probe accepted a partial capture of 1.00 on this guest card authorization at age 3.5075 days (run 42538613566, 9 Nov 2026, docs/evidence/G3-early/); that is an early reading, not part of the G2 result.

## G3: honor period versus validity and reauthorize

Status: NOT RUN
Run date / by: IN PROGRESS, real probe, day 0 was 7 Nov 2026 03:06 UTC (`.github/workflows/gate-g3.yml`; the earlier attempts on 4-7 Nov never ran, so no earlier day is claimed). Checkpoints at 3.5, 4 and 5 days; the final reading is about 12 Nov 06:17 UTC. Until those results exist the gate reads NOT RUN / IN PROGRESS.
Early evidence: Additional early reading (not the full 5-day result): two older G2 authorizations are probed by `gate-g3-early.yml` (PR #1929, merged to main). Redacted copies of its artifacts are committed under docs/evidence/G3-early/: g3-early-20261108T173529Z-read.json (sha256 47614397eda0f8d9b2c86ebd11c0414f9cdb8af4800acad90284caa880dc8477, run 42505706359, read only: both authorizations CREATED at ages 3.2374 and 3.234 days), g3-early-20261108T173639Z-probe.json (sha256 8f399464a0f0dd88a61d55f79128aa218507586c04c2dd5ae87078dfd2956b3a, run 42505780514: G2-wallet at 3.2383 days, capture HTTP 201, reauthorize 422 PAYER_CANNOT_PAY, then PARTIALLY_CAPTURED; G2-card not probed) and g3-early-20261109T000920Z-probe.json (sha256 7dfdc5277552d09e163a7e2a3f6800171bba8bce852319c6d917175b424df769, run 42538613566: G2-card at 3.5075 days, still CREATED, capture HTTP 201, reauthorize 422 PAYER_CANNOT_PAY, then PARTIALLY_CAPTURED; G2-wallet already PARTIALLY_CAPTURED and not probed). The artifact copies differ from the committed ones only by the line layout of one array (prettier). What this shows: a partial capture of 1.00 was accepted on both used authorizations after 3 days, and reauthorize was refused on both. What it does not show: the G3 validity window, whether reauthorize extends it (the probe captures 1.00 and then calls reauthorize in the same run, so the refusal is on an authorization that already holds a partial capture, which is not the clean reading), void of a guest card authorization, or a `final_capture`. G3 stays NOT RUN / IN PROGRESS.
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

Status: PARTIAL
Run date / by: 2026-11-07, cached eval over recorded provider outputs (PR #1940, issue #1864; second clip set PR VOI-01; error analysis, parser fixes and option trials PR VOI-02)
Question: is the speech-to-text accuracy on noisy bid audio high enough to accept bids without manual confirmation?
Setup: synthetic eSpeak speech (noise-free and robotic), 24 clips, and a second set of the same 24 utterances in a human-like synthetic voice, both scored by the cached eval. Deepgram nova-3 (`punctuate=true`, `smart_format=false`) and Groq whisper-large-v3-turbo with a bid-words prompt and temperature 0 (the options chosen in the option trials below). The first recordings used Deepgram nova-2 and Groq without a prompt and failed.
Requests: every clip was sent to each provider once per variant; the outputs are recorded under `packages/voice/fixtures/stt-cache` and `stt-cache-human` and scored through the rule parser, with the room gate run on top.
Observed: on both clip sets and both providers, wrong accept 0.000, exact plus recoverable 1.000, missed bid 0.000 (exact 1.000 for Deepgram, 0.923 for Groq; the rest recoverable through a confirm prompt). Confirm rate 0.292 (Deepgram) and 0.333 (Groq). At system level no bid is accepted without a prompt on the room microphone (0 of 24 auto-accepted, by construction); on a device microphone with an always-agreeing second reading, 0 of the 3 or 4 auto-accepted bids per run were wrong.
Verdict: the measured numbers meet the gate criteria (wrong accept 0.05 or less, exact plus recoverable 0.90 or more) on synthetic clips, but they are not a pass of the gate question: the parser rules and the provider options were chosen after reading the failures on these same 24 clips (in sample), the audio is noise-free, 24 clips move a rate by 0.042 per clip, and there is no real-room or noisy-room run. Before this change the same clips failed (wrong accept 0.083 to 0.167), but 9 of the 11 wrong accepts were an evaluation defect (the manifest paddle label was ignored), not a speech or parser error.
Decision: PARTIAL, gate stays open. Spoken bids keep going through the confirm prompt (assist mode); no code path enables auto-accept of spoken bids, and the room microphone cannot reach AUTO at all. The payments decision is unchanged.
Fallback if FAIL: always show the confirm prompt for spoken bids.
Evidence: PR VOI-02 (cached job artifacts of the `voice-eval` workflow, option trials runs 42364412751 and 42365428369); docs/evidence/G5/ERROR-ANALYSIS.md; clips under packages/voice/fixtures/audio and audio-human, recorded outputs under stt-cache and stt-cache-human. First results: PR #1940 (merged).
Links: issues #1864 and #478
Live socket run (https://github.com/harshbhx/gavel-auction/actions/runs/42575018866, workflow `evidence-voice-live-socket`, 9 Nov 2026): The live /audio socket was run once with both providers (run 42575018866): the 24 committed synthetic clips were streamed in real time with an auctioneer token to the real server process (fake PayPal), the live provider answered 24 of 24 clips for each, and no spoken bid was accepted without a confirm (5 confirm prompts, 19 clips with no room action, 0 accepted). The log scan of the server log found 0 findings with the provider key as the canary. Groq: transcript equals the spoken text for 12 of 24 clips, caption latency after the end of speech p50 191 ms, p95 489 ms, max 513 ms. Deepgram: transcript equals the spoken text for 21 of 24 clips; its caption latency reads 0 ms for every clip, which is not a meaningful latency number (final transcripts arrive before the speech ends in the streaming path), so none is claimed. Limits: Synthetic clips, fake PayPal in the server, no human voice and no real room; The web console now has an auctioneer microphone (FEAT-62, added after this run; it works only when the server reports a live speech provider, and a bidder phone has no microphone). This does not change G5, which stays PARTIAL. Evidence in docs/evidence/voice-live-socket/: LIVE-SOCKET-groq.json (sha256 e3c81ed9a261318eed5f8f0c70122edb00e403c667efacbaa8b49f2f402744c6), LIVE-SOCKET-groq.md (sha256 e5eb3ada95bda25f4ce32cc42ad612afd1eb97365106b19343f1ba1b239c8152), LIVE-SOCKET-deepgram.json (sha256 85905621e5743260b7a61ca7d82e91c5b22a21f259b66b7bb6e9ecb2ef4031cf), LIVE-SOCKET-deepgram.md (sha256 6cd60063ed3d58db794a527aa5ff3814a396586470c23cfcc535b04f938b1321); the other files and their sha256 values are listed in its README.
Held-out noisy set (measured once): On a synthetic held-out set measured once (120 clips: eSpeak speech, simulated room and babble noise at 20, 10 and 5 dB, run 42567832671), neither provider met the pre-registered thresholds: Groq wrong accept 0.058 and exact plus recoverable 0.923, Deepgram wrong accept 0.092 and exact plus recoverable 0.744, against 0.05 and 0.90; this is worse than the in-sample result. Per provider, wrong accept per SNR cell (20, 10 and 5 dB, n=40 each): Groq 0.050, 0.050, 0.075; Deepgram 0.075, 0.100, 0.100 (line 0.05 in every cell). Groq met exact plus recoverable (0.923) and missed the overall wrong-accept line and the 5 dB cell; Deepgram missed all lines. Here a wrong accept is a clip where the parser answered accept (a bid taken without a confirm prompt) with a pair other than the spoken bid, counted over all 120 clips; the parser asked for a confirm on 0.175 (Groq) and 0.233 (Deepgram) of the clips. On the room microphone no bid is auto-accepted by construction (0 of 120, neutral speech-to-text confidence assumed), so the wrong accepts above are parser answers, not bids that reached the auction. The audio is synthetic and robotic and the noise is simulated; no real room or person. The set was measured once, nothing was tuned on it, and any later parser, option or threshold change made after reading these failures counts as in-sample. G5 stays PARTIAL. Evidence: docs/evidence/G5/HELDOUT-NOISY.md and docs/evidence/G5/heldout/ (sha256 values in that file), pre-registration docs/evidence/G5/HELDOUT-NOISY-PREREG.md.

### G5 results after the VOI-02 changes

Same 24 utterances, two clip sets, both synthetic and noise-free. Scored by the cached eval with the
parser and recordings of this change. The four rows below are the current result.

| clip set                                         | provider                                | n   | exact | wrong accept | confirm | missed bid |
| ------------------------------------------------ | --------------------------------------- | --- | ----- | ------------ | ------- | ---------- |
| eSpeak (robotic), noise-free                     | Deepgram nova-3                         | 24  | 1.000 | 0.000        | 0.292   | 0.000      |
| eSpeak (robotic), noise-free                     | Groq whisper-large-v3-turbo, bid prompt | 24  | 0.923 | 0.000        | 0.333   | 0.000      |
| human-like synthetic voice, noise-free, 24 clips | Deepgram nova-3                         | 24  | 1.000 | 0.000        | 0.292   | 0.000      |
| human-like synthetic voice, noise-free, 24 clips | Groq whisper-large-v3-turbo, bid prompt | 24  | 0.923 | 0.000        | 0.333   | 0.000      |

Exact plus recoverable is 1.000 in all four rows. Exact counts the 13 bid clips; wrong accept and
confirm count all 24 clips.

Before (main, PR #1940 and VOI-01; Deepgram nova-2 and Groq without a prompt):

| run before this change             | provider                    | n   | exact | wrong accept | confirm | missed bid |
| ---------------------------------- | --------------------------- | --- | ----- | ------------ | ------- | ---------- |
| main, eSpeak, noise-free           | Deepgram nova-2             | 24  | 0.615 | 0.125        | 0.417   | 0.000      |
| main, eSpeak, noise-free           | Groq whisper-large-v3-turbo | 24  | 0.615 | 0.083        | 0.375   | 0.077      |
| main, human-like voice, noise-free | Deepgram nova-2             | 24  | 0.692 | 0.083        | 0.375   | 0.000      |
| main, human-like voice, noise-free | Groq whisper-large-v3-turbo | 24  | 0.615 | 0.167        | 0.250   | 0.154      |

Where the change came from, with the new parser and the same old recordings (nova-2, no prompt) and
with the label fix alone. Exact, wrong accept (clips), exact plus recoverable:

| step                                     | Deepgram eSpeak | Groq eSpeak     | Deepgram human  | Groq human      |
| ---------------------------------------- | --------------- | --------------- | --------------- | --------------- |
| main                                     | 0.615, 3, 0.692 | 0.615, 2, 0.615 | 0.692, 2, 0.692 | 0.615, 4, 0.615 |
| eval label fix only (derived by recount) | 0.769, 1, 0.769 | 0.769, 0, 0.769 | 0.846, 0, 0.846 | 0.846, 1, 0.846 |
| plus parser fixes (same recordings)      | 0.846, 0, 0.846 | 0.769, 0, 1.000 | 1.000, 0, 1.000 | 0.846, 0, 1.000 |
| plus provider options (final)            | 1.000, 0, 1.000 | 0.923, 0, 1.000 | 1.000, 0, 1.000 | 0.923, 0, 1.000 |

The label-fix row is a recount of the committed confusion lists of main (the run itself was
cancelled on CI); the parser row is the option-trial rows `dg-nova2-base` and `gq-turbo-base` of the
trials table in docs/evidence/G5/ERROR-ANALYSIS.md.

Train and hold-out, in the sense that is possible on 24 clips. The 9 train clips are the ones whose
failures drove a rule (a03, a05, a07, a08, a09, a10, a13, a18, a21); the 15 hold-out clips were not
used for a rule and passed before. The hold-out therefore checks for regressions; it is not an
independent test, and a fresh clip set was not recorded. Exact, wrong accept (clips), exact plus
recoverable on the train clips: Deepgram 1.000, 0, 1.000 on both sets; Groq 0.857, 0, 1.000 on both
sets (main: Deepgram 0.286 and 0.429 exact, Groq 0.286, with 2 to 4 wrong accepts per run). On the 15
hold-out clips: 1.000, 0, 1.000 for all four runs, unchanged from main. The held-out text corpus (40
cases, hash-guarded, not used for any rule) is unchanged: exact 0.864, wrong accept 0.000 before and
after.

Option choices were made on the aggregate of the 48 clip runs per provider (docs/evidence/G5/ERROR-ANALYSIS.md,
option trials), so they are in sample too. The estimated spend of the trials is under 0.15 US dollars
at Deepgram (about 340 short clips); Groq ran on its free tier; no new speech clips were generated.

### G5 system level: AUTO against CONFIRM (issue 478)

Raw parser accuracy is not what the room does. The eval also runs every utterance through the room
pipeline (rules parse, rescoring, validation, AUTO and CONFIRM policy, mic rule) and counts what the
room would accept without a prompt. The rate below is the wrong bids among the auto-accepted bids.

| gate setting                                                         | auto-accepted (of 24 per run) | wrong among auto-accepted |
| -------------------------------------------------------------------- | ----------------------------- | ------------------------- |
| room microphone (what the room runs), rules only                     | 0, 0, 0, 0                    | 0 of 0 (by construction)  |
| device microphone, rules only (no second reading)                    | 0, 0, 0, 0                    | 0 of 0                    |
| device microphone, a second reading that always agrees (upper bound) | 4, 4, 3, 4                    | 0 of 15                   |

Order in each row: Deepgram eSpeak, Groq eSpeak, Deepgram human, Groq human. A room microphone
confirms every bid first (R12-V02). Without a second reading a rules-only bid tops out at 0.82, below
AUTO 0.85, so it is confirmed too. With a second reading that always agrees (the rule parse standing in
for the model, so it also agrees with every wrong rule reading), a bid reaches AUTO only when the speaker
named a paddle on a device microphone; the 3 or 4 bids per run that did were all right. The threshold
sweep after the gate (0.70 to 0.95) is flat at 0 wrong accepts in every run. Both numbers are honest and
different: raw parser wrong accept is 0.000 on these clips, and the confirm gate keeps the auto-accepted
wrong rate at 0 by construction. Neither is evidence about a real room. Decision on thresholds: keep
AUTO 0.85 and CONFIRM 0.50; nothing in the audio sweep argues for a change, and lowering AUTO would not
be justified by 15 auto-accepted bids.

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

Not measured at the text level: audio, speech-to-text error and latency (text mode reports 0 ms). The cached
mode is measured: recorded provider outputs are in the repo under `packages/voice/fixtures/stt-cache` and
`stt-cache-human` and are scored in the G5 sections above. No live provider run was done, and the
calibration of issue 478 is described below. The G5 status above comes from the synthetic runs (PR #1940, VOI-01 and VOI-02); there is no real-room or noisy-room run.

### G5 threshold calibration (issue 478)

Decision: keep the defaults AUTO 0.85 and CONFIRM 0.50 (`defaultConfig`, R-VOX-063). Rationale: the
text-level sweep above is flat from 0.70 to 0.95 (the parser emits only 0.50, 0.95 and 1.00), wrong
accepts are 0.000 on the dev and held-out sets, and the confirm rate is 0.272 on the 169 cases. The
audio sweep (cached mode on both clip sets, both providers, room and device microphone, with and without
an agreeing second reading) is flat at 0.000 wrong accepts from 0.70 to 0.95, so the audio set cannot
move the thresholds either way; the system-level result is in "G5 system level" above. The held-out
text set was not used. Revisit when a noisy or real-room clip set exists: if any wrong accept shows up
there, raise AUTO to the lowest sweep value with zero wrong accepts.

Live run (not in pull request CI): `npm run gate:g5 -w @gavel/e2e -- --write-gates` sends 20 noisy
recorded bids (`G5_AUDIO_DIR/g5-01.wav` to `g5-20.wav`, supplied privately) to the live provider
(`DEEPGRAM_API_KEY`) and then to the rule parser, and fills this section and a `G5-live` table. It
prints `skipped` when the key or a recording is missing. The nightly workflow
`.github/workflows/nightly-sandbox.yml` calls it too. Verdict: PASS needs exact plus recoverable
confirm at 0.90 or more and wrong accepts at 0.05 or less; PARTIAL needs 0.70 or more; otherwise FAIL.

## Decision

Interim decision: GO, with documented fallbacks. This is not a final go: G3 is IN PROGRESS and G5 is PARTIAL (synthetic speech only, tuned on the same clips), so voice bids use the confirm prompt.

Verified, with evidence above:

- Wallet and card AUTHORIZE work (G2), so the card and guest path is on (`g2_card_authorize` true).
- Partial capture with `final_capture` closes the authorization as CAPTURED for two PayPal-account buyers (G1, decision A); that the remainder is released is inferred, not observed.
- Real webhooks verify through PayPal's endpoint (G4). Tampered-event rejection is covered against the fake only.
- The sandbox app and buyer accounts work (G0; redacted evidence file committed from the 9 Nov re-run, run 42555610707).

In progress and partial:

- G3 (honor period, validity and reauthorize): NOT RUN / IN PROGRESS (day 0 7 Nov 2026 03:06 UTC, final about 12 Nov 06:17 UTC). Fallback: capture within the verified validity window and use the reauthorize path (spec R3, T-QA-052) before hammer. R3 is the plan, not a result: it is not verified until G3 runs.
- G5 (speech-to-text accuracy on noisy bids): PARTIAL. On synthetic speech, 24 eSpeak clips and 24 human-like clips, Deepgram nova-3 and Groq whisper-large-v3-turbo with a bid prompt score wrong accept 0.000 and exact plus recoverable 1.000, after fixes chosen on the same clips; the earlier nova-2 run measured 0.083 to 0.167 (nine of eleven wrong accepts were an evaluation label defect). Fallback: voice bids always go through the confirm prompt (assist mode). Scope: no real-room test yet. One synthetic held-out noisy set was measured once against the pre-registered thresholds: wrong accept 0.058 (Groq) and 0.092 (Deepgram) against 0.05 (run 42567832671).

What changes the decision:

- G3 shows a validity window shorter than the longest planned auction, or reauthorize does not extend it: auctions are capped to the validity window and the demo stays short, or the decision moves to NO-GO for long auctions.
- G3 passes with a window that covers the planned auctions: the decision becomes GO for card and wallet.
- G5 PARTIAL (the current state): voice bids stay behind the confirm prompt; the payments decision is unchanged. The synthetic held-out noisy set measured on 9 Nov (run 42567832671) read 0.058 and 0.092 against 0.05, so it leaves the gate open; a real-room or new noisy clip set that keeps wrong accept at 0.05 or less, together with an owner decision, would be needed for PASS.
- A later run of G1, G2 or G4 that no longer matches the recorded evidence reopens that gate and the flag that depends on it.

## Latency targets and measured numbers

Status: PARTIAL (issue 244). One target is met (hammer to SETTLED, 6 s) and one is missed (hammer to CAPTURED, 2.5 s), both measured end to end on the real sandbox.
Evidence: run 42346811713 (https://github.com/harshbhx/gavel-auction/actions/runs/42346811713, workflow `measure-sandbox`, mode `settlement`); redacted copies committed under docs/evidence/measure/: measure-settlement.json with sha256 c5b42430160822e76dd872b985a63469e91649481eea403fc46825c3b7372a4c, and measure-settlement.md with sha256 183ec86fee9666a4e3edab3c436552c4e637c4222fed8875eb35020f1da09dcb (the CI artifact had sha256 47eab28a90344fe9c84ac4edf5d862db3e4442916914d9f42bc9b3ad8dfcbaa6 and differs only by table alignment from prettier).

Targets (R-PAY-152) against the sandbox measurement. Call table date: 2026-11-05. Workflow: `measure-sandbox`, run 42047543821 (https://github.com/harshbhx/gavel-auction/actions/runs/42047543821). Real PayPal sandbox, 10 sequential cycles, 0 failures, so n=10 per call. The raw evidence is not committed; the run log is the only record and it expires with the Actions log retention. These numbers are not independently verifiable until a redacted log is committed.

| Call      | p50 (ms) | p95 (ms) | max (ms) |
| --------- | -------- | -------- | -------- |
| order     | 650.88   | 758.5    | 758.5    |
| authorize | 1299.04  | 2268.65  | 2268.65  |
| capture   | 1871.69  | 2280.66  | 2280.66  |
| void      | 939.76   | 1235.96  | 1235.96  |

Earlier, the same script ran against the fake PayPal (`npm run measure -w @gavel/payments -- --fake`, 2026-11-04, 50 sequential and 10 parallel cycles). Those numbers were our client overhead on loopback, not PayPal latency, and they do not count as a sandbox measurement.

| Target                                   | Value  | Measured (sandbox)                                                                                                                                                 | Status                                                                            |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| hammer to CAPTURED p95                   | 2.5 s  | end to end, 49 of 50 completed, 6 holds: p95 3766.67 ms (p50 2784.72, max 5094.52); earlier n=20: p95 3010.04 ms; capture call alone (5 Nov, n=10): p95 2280.66 ms | MISSED (run 42563147792, INCOMPLETE; earlier run 42346811713 also missed)         |
| hammer to SETTLED, 6 holds, p95          | 6 s    | end to end, 49 of 50 completed, 6 holds: p95 6927.43 ms (p50 5577.10, max 8622.66); earlier n=20: p95 5591.30 ms                                                   | MISSED (run 42563147792, INCOMPLETE); earlier n=20 run 42346811713 was within 6 s |
| webhook handler 200, without verify call | 300 ms | hosted route p95 112.03 ms (n=50, runner network included, run 42558107791); handler alone p95 1.07 ms (n=500, loopback)                                           | MET (run 42558107791)                                                             |

Hosted evidence (run 42558107791, https://github.com/harshbhx/gavel-auction/actions/runs/42558107791, workflow `evidence-hosted`, 9 Nov 2026, started 03:45 UTC): (1) Warmup after idle: two samples, each after a 16 minute sleep. `/warmup` took 662.17 and 249.35 ms (max 662.17 ms against the 3000 ms budget: MET) and `/healthz` 138.05 and 233.41 ms. This is n=2, a small sample. The host may never go cold, because the uptime workflow pings it every 5 minutes, so these may be warm-host numbers. The owner redeployed Render during the run (about 03:50 UTC), which can skew the warmup samples. (2) Webhook route on the hosted API: n=50, p50 89.06, p95 112.03, p99 176.35, max 176.35 ms against the 300 ms target: MET. The client was a GitHub runner, so the network is included and the figure is an upper bound for the handler; the event type was ignored, so no verify call was made and nothing was stored. (3) The handler alone on loopback (artifact `webhook-handler-evidence`): n=500, p50 0.71, p95 1.07, p99 3.25, max 22.88 ms, verify not called, network and PayPal not included. A real signed delivery with the verify call was not timed. Evidence in docs/evidence/hosted/: hosted-evidence.json (sha256 67b230a3605457d8d2955f6ea5166f1da745b9cb7ff3e5d8374aa389699a50e8), hosted-evidence.md (sha256 056b51031871ad413757b3bf7cc37f4954fbc089c17e42e21eafd830d785e3c2; prettier changed the table alignment of the artifact copy), warmup-samples.json (sha256 fe85c917ab2f4317fc9f00d27ffeba8dd2df4368e713634a187152651b90facd), webhook.json (sha256 d5b34663e8910076b58c1106c4d37256b70bdba535c234af78fc695dbca32453; prettier changed the array layout of the artifact copy), webhook-handler.json (sha256 a765b926ceb7e90a766cb2c99fcda1e2bd3d0e9bbd07ee5b0a977df19830f0a9) and judge.json (sha256 5359641160f08e29de80b5fb063e085dd19afe90450d8f1e7ee01b25ba4f0140). The report also lists the last five judge-smoke runs (3 success, 2 failure); the three successes lasted 8 to 87 seconds because older smoke runs only loaded the landing page, so they are not evidence of the judge journey. Judge smoke: run 42584326641 (https://github.com/harshbhx/gavel-auction/actions/runs/42584326641, manual dispatch, 9 Nov 08:13 UTC, live journey with simulated holds, desktop profile) passed all 17 steps, including step 16 (hammer). The earlier run after the redeploy, 42561627128 (https://github.com/harshbhx/gavel-auction/actions/runs/42561627128, 9 Nov 04:24 UTC), passed steps 1 to 15 and 17; its step 16 (the console shows the lot as closed or sold) was fixed afterwards (issue #2208, PR #2209). No staging security test or load test against the Render API is recorded in this file; those stay UNVERIFIED until a run is recorded here.

Fallback: where a target is not met on sandbox numbers, the target is raised to the sandbox p95 (a decision for the owner; targets are not raised automatically). The CAPTURED target is missed: its end-to-end p95 is 3766.67 ms (49 of 50 settlements timed; the earlier n=20 run had 3010.04 ms) against 2500 ms, and the capture call alone has p95 2280.66 ms (5 Nov, n=10), which leaves about 0.2 s for the truth check and journal writes. Reaching 2.5 s would need a change in PayPal call behaviour, which is not made here. The SETTLED target is missed on the 49-of-50 run (p95 6927.43 ms against 6000 ms; the earlier n=20 run had 5591.30 ms, a smaller sample), so the fallback applies to it too, and the earlier statement that it is met is superseded by this run. Whether to keep the 2.5 s target, change the saga or raise the target is an owner decision, still open. The saga defaults below are not changed by this record.

Latency evidence run (issue #2273): Run 42563147792 (https://github.com/harshbhx/gavel-auction/actions/runs/42563147792, workflow `evidence-latency`, 9 Nov 2026), verdict INCOMPLETE: 50 settlements of 6 holds were run, 49 were timed and 1 ended in a TimeoutError, and 3 capture calls failed. End to end (49 of 50 completed): hammer to CAPTURED p50 2.78 s, p95 3.77 s, max 5.09 s against 2.5 s: MISSED; hammer to SETTLED p50 5.58 s, p95 6.93 s, max 8.62 s against 6.0 s: MISSED. The reported percentiles are over the 49 that completed; counting the timed-out settlement as the worst case, the p95 over all 50 attempts is at most 5.09 s (CAPTURED) and at most 8.62 s (SETTLED), so neither verdict changes. Per call (60 cycles): order p95 1.23 s, authorize p95 1.54 s, capture p95 2.72 s (3 failed calls; the report lists n=59), void p95 1.25 s, all above the 1 s per-call budget. The earlier n=20 run (42346811713: SETTLED p95 5.59 s, CAPTURED p95 3.01 s) stays as an earlier, smaller sample and no longer supports the claim that SETTLED is met. Owner decision open: keep the targets, raise them with a reason, or reduce latency. Evidence under docs/evidence/latency/: latency-evidence.json (sha256 b70afc9a5b46a9c175e7ec61e028e1a577af359495e5028aa8fd74a290ab130c), latency-evidence.md (sha256 9c96ec2dca4cbc4126da5d67929aa47d640f6ffda8eca09d3623307af100294a), per-call-measure-sandbox.json (sha256 d35671f9127e6fee2c9d3d1a91ae67b7d8a90515a4672e0b541d1d1ef84ae1a6), per-call-measure-sandbox.md (sha256 2bc5c2297e6cd18ee7f3c3e79387cce8f9be3c9851977b4185153fc878252319), settlement-measure-settlement.json (sha256 9ce414af201afcd028c252fced734f559770c465c4c8faa338afc9698789ded3), settlement-measure-settlement.md (sha256 6b34319f97a56eeca201dbd7e76ff73024e7d59d81bd5781687bc87d22b5b8cc). The `.md` and `.json` files were re-laid out by prettier; the numbers are those of the artifact `latency-evidence`.

End-to-end settlement measurement (issue 244): status PARTIAL, measured. `npm run measure:settlement -w @gavel/e2e` (script `packages/e2e/src/sandbox/measure-settlement-cli.ts`) settles lots on the real sandbox with the real saga and `PayPalGateway`: it creates real approved authorizations (6 holds per settlement, one winner), starts the clock at the hammer and records hammer to CAPTURED (winner's capture journaled) and hammer to SETTLED (all other holds voided). After each sample PayPal is read back, and a sample that does not show one capture and the rest VOIDED counts as a failure. Output is counts and milliseconds only. Run 42346811713 (`measure-sandbox`, mode `settlement`, 20 settlements x 6 holds, voidConcurrency 3, 120 authorizations): 0 failed, 0 mismatches, 0 errors. Hammer to CAPTURED: p50 2558.73, p95 3010.04, p99 3251.97, max 3251.97 ms. Hammer to SETTLED: p50 4937.13, p95 5591.30, p99 5724.31, max 5724.31 ms. A pilot run (42346020463, 3 settlements) came before it and is not committed. With n=20, p99 and max are the same sample for both spans, so the sample is small. The redacted copy is committed under `docs/evidence/measure/`.

Rate limit: 0 answers with 429 and no `Retry-After` header in 60 cycles against the fake. The real limits are UNVERIFIED (G1 measurement).

Budget with sandbox numbers: a settlement of 6 holds is one truth check, one capture and 5 voids. With 3 voids at a time that is two void waves. Using the 5 Nov p95 for the capture and void calls alone gives 2 x 1235.96 + 2280.66 = 4752.58 ms, before the truth check. The earlier end-to-end run (n=20) included the truth check and gave SETTLED p95 5591.30 ms, about 0.4 s inside 6 s on that sample of 20; the later run (49 of 50 completed) gave 6927.43 ms, so the 6 s target is missed and that margin did not hold.

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
- G2: R2 stops at CREATED; no void of a card authorization ran in the nightly. A 1.00 partial capture on the guest card authorization was accepted only in the early G3 probe (run 42538613566, 9 Nov).
- G3: no honor-period or validity-window result; those results are still pending. The G3 probe runs every 6 hours (`gate-g3.yml`, cron `17 */6 * * *`) and the final reading is about 12 Nov 06:17 UTC. R3 answered 422, so reauthorize is unproven on this run.
- G4 staging: R4 was skipped. A real server kill ran later in workflow `evidence-server-kill` (run 42558021614, 9 Nov 2026; see "Real server kill" below); R10 is the in-process crash only.
- G5: no audio ran, so no speech-to-text accuracy exists.
- R9 is not in the report counts; its pass comes from vitest output only.
- Latency: this run recorded no timings for the targets, so the table above is unchanged. The void p95 caveat stands: 1235.96 ms against the 1000 ms budget, and, as of 6 Nov, the SETTLED budget assumption (each call under 1 s at p95) failed; the Latency section above records SETTLED as MISSED on the 49-of-50 run 42563147792 (the earlier n=20 run 42346811713 had it within 6 s).
- Only the run log and the summary artifact exist; no redacted evidence file is committed, so the figures are reported, not independently verifiable, until one is.

Decision: no change. G1 PASS (decision A), G2 PASS, G3 NOT RUN / IN PROGRESS, G5 PARTIAL on synthetic speech (confirm prompt kept).
Evidence: redacted copies of the report are committed as `docs/evidence/nightly/NIGHTLY-42200708552.json` (sha256 d52637150b0fa9a4e6eafc8a2bb873227a75e797cef2093d19eb1e56e944de5b) and `docs/evidence/nightly/NIGHTLY-42317068784.json` (sha256 d3f4add63b30e08066daa83c0a7d289fae880472e94d98582065d859a7a05652); they hold spec ids, statuses and observed summaries only. The raw job logs remain Actions logs.

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
every spec file in `packages/e2e/sandbox` through `npm run test:sandbox -w @gavel/e2e` (R1 to R4, R5 to R8, R9 and R10)
at 20:30 UTC and on manual dispatch. R9 is skipped unless the second and third sandbox buyer secrets
(`SANDBOX_BUYER2_*` and `SANDBOX_BUYER3_*`) are also set. The same job then runs the G5 speech harness
(`npm run gate:g5 -w @gavel/e2e`), which skips each provider whose key or audio recordings are missing; G5 stays NOT RUN
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
evidence for the deployed host; a real process kill on a CI runner is recorded under "Real server kill" below. R10 has passed in the nightly runs of 6 and 7 Nov 2026 (see "Status of crash safety" below).

Real server kill: a real server process on a CI runner against the real PayPal sandbox, one SIGKILL after the capture request and before the response, restart on the same data folder, journal SETTLED, one capture of 12500 equal to the hammer price, two losers voided, journal equals PayPal, ledger chain verifies (19 entries), ledger capture equals PayPal (12500). Run 42558021614 (https://github.com/harshbhx/gavel-auction/actions/runs/42558021614), workflow `evidence-server-kill` on `main`, 9 Nov 2026 03:45 UTC, verdict PASS. Server pid 3299 ended at the armed checkpoint `after_capture_request_before_response` (the evidence records that the process ended itself there); a read of PayPal after the kill and before the restart already showed the winner CAPTURED 12500 with one capture and the two losers CREATED with nothing captured; the restarted process (pid 3567) found the journal SETTLED 9.4 seconds after the hammer, and the two losers read VOIDED with nothing captured. Evidence: docs/evidence/server-kill/server-kill-evidence.json (sha256 8e419bc84e564a311b0e6f5caeae3d7f64092cd974ac1c704cbcda517f38f3ab), server-kill-evidence.md (sha256 b9c84fb01e8cd963ebbaacc02d6fea8ce89a139167e7d7642ab470cc53b1c4ba; the artifact copy differs only by table alignment from prettier) and server-kill-transcript.jsonl (sha256 dfb7b2d2a9abeb66ee78246629a6d56ce6a93c225cf2a1816866222842b35caa; PayPal requests and responses with tokens, ids of the app and headers redacted). Limits: It is not the deployed Render host (that run is still open), it is one run, and it has one kill point. Other kill points, the deployed host and repeated runs are not shown. R4 and the G4 staging row are unchanged.

Status of crash safety: What ran on the real PayPal sandbox, from the `sandbox-report` artifact (`report/sandbox.json`) of two runs of workflow `nightly-sandbox` on `main`: run 42200708552 (6 Nov 2026, manual dispatch) and scheduled run 42317068784 (7 Nov 2026 00:15 UTC). Both report the same: R7 (one lot of three holds settled by the real saga and `PayPalGateway`: the winner captured 12500 cents, the others voided, saga SETTLED, journal against PayPal 0 differences), R8 (reconciliation, 0 differences) and R10 (one in-process crash at the `after:capture` boundary, the resume adopted the capture: one capture on the winner, losers voided), all on PayPal-account orders. What did not run on the real sandbox in these two nightly runs: an auction driven through the deployed server, and a real server process kill and restart (R4 was skipped, no staging host); the kill ran later, see "Real server kill" below. R10 kills nothing: the crash is an exception thrown in the test process. Everything beyond those specs (many lots, injected faults, 30 simulated days) ran against the fake PayPal only. G3 (authorization validity and reauthorize) is NOT RUN / IN PROGRESS, so holds in an auction longer than minutes may expire before capture.
