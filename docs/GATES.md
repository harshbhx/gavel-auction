# Gates

A gate is CLOSED only when Status is PASS or FAIL with a recorded Decision. PARTIAL stays open.
A gate without evidence reads NOT RUN. PASS, PARTIAL and FAIL need an Evidence line.

## G1: partial capture and remainder release

Status: PASS
Run date / by: 2026-11-04 by harshbhx
Question: after authorize 500.00 and capture 350.00 with final_capture=true, is the 150.00 remainder released or still active?
Setup: sandbox, wallet buyer only (no passwords recorded), script version 7e83b05.
Requests: create order (AUTHORIZE 500.00), buyer approval, authorize, capture 350.00 with final_capture, read the authorization and order, then an explicit void of the remainder.
Observed: after the final capture the authorization reads CAPTURED and the order COMPLETED, so the remainder is released without a void. An explicit void afterwards answers HTTP 422 PREVIOUSLY_CAPTURED. The capture accepted `invoice_id` and the order lists it on the capture.
Verdict: remainder released (decision A).

| id                                               | expected             | actual                                                                         | verdict  |
| ------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------ | -------- |
| G1.5 wallet capture 350 with final_capture       | accepted             | HTTP 201 COMPLETED                                                             | observed |
| G1.6 wallet remainder status after final capture | open or released     | authorization CAPTURED, order COMPLETED: released                              | observed |
| G1.7 wallet explicit void of the remainder       | accepted or rejected | HTTP 422 UNPROCESSABLE_ENTITY PREVIOUSLY_CAPTURED, authorization then CAPTURED | observed |
| G1.8 wallet decision                             | A, B or C            | A                                                                              | observed |

Decision: PASS-WITH-FALLBACK
Fallback if FAIL: wallet buyers only, card untested (R-PAY-037).
Evidence: docs/evidence/G1/G1-20261104T231047Z.jsonl (sha256 8ac39be0454bcab5c7e2764d87d1d09566ac384681fc3e361285f78c70422bb8)
Links: spec tags flipped: R-PAY-059, R-PAY-051.
Scope: wallet buyer only. The card buyer was not tested, so the result does not cover card buyers (R-PAY-037); G2 stays NOT RUN.
Saga: a void refused with PREVIOUSLY_CAPTURED on the winner's remainder is treated as released (packages/payments/src/errorMap.ts, saga/remainder.ts).

## G2: card and guest AUTHORIZE

Status: NOT RUN
Run date / by: n/a
Question: does an Orders v2 intent AUTHORIZE flow work for card and guest checkout buyers in the sandbox?
Setup: n/a
Requests: n/a
Observed: n/a
Verdict: n/a
Decision: n/a
Fallback if FAIL: restrict registration to wallet buyers.
Links: n/a

## G3: honor period versus validity and reauthorize

Status: NOT RUN
Run date / by: n/a
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
Scope: tampered-event rejection was not part of this run; it is covered against the fake only. Retry schedule and PAYMENT.CAPTURE.DENIED/PENDING shapes stay UNVERIFIED.

## G5: STT accuracy on noisy bids

Status: NOT RUN
Run date / by: n/a
Question: is the speech-to-text accuracy on noisy bid audio high enough to accept bids without manual confirmation?
Setup: n/a
Requests: n/a
Observed: n/a
Verdict: n/a
Decision: n/a
Fallback if FAIL: always show the confirm prompt for spoken bids.
Links: n/a

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
threshold calibration of issue 478. The G5 status above stays NOT RUN until the audio steps run.

## Latency targets and measured numbers

Targets (R-PAY-152) against the first measurement. The run is `npm run measure -- --fake` in the `payments-evidence` workflow (50 sequential and 10 parallel cycles against the fake PayPal, 2026-11-04). The fake answers on loopback, so these numbers are the overhead of our own client and not PayPal's latency. Sandbox numbers stay UNVERIFIED (G1 measurement) until the same script runs there; the fallback is to raise the targets to the sandbox p95.

| Target                                   | Value  | Measured (fake)                                              | Status     |
| ---------------------------------------- | ------ | ------------------------------------------------------------ | ---------- |
| hammer to CAPTURED p95                   | 2.5 s  | capture p95 1.37 ms sequential, 18.33 ms with 10 in parallel | UNVERIFIED |
| hammer to SETTLED, 6 holds, p95          | 6 s    | void p95 0.95 ms sequential, 5.77 ms with 10 in parallel     | UNVERIFIED |
| webhook handler 200, without verify call | 300 ms | not part of this script (covered by T-PAY-068)               | UNVERIFIED |

Rate limit: 0 answers with 429 and no `Retry-After` header in 60 cycles against the fake. The real limits are UNVERIFIED (G1 measurement).

Budget with sandbox numbers still open: a settlement of 6 holds is one truth check, one capture and 5 voids. With 3 voids at a time that is about 6 sequential call latencies, so the 6 s target holds while a call stays under 1 s at p95.

Saga defaults (`SAGA_DEFAULTS` in `packages/payments/src/config.ts`, equal to the constants in the saga):

| Setting           | Value  | Reason                                                                                                                              |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| voidConcurrency   | 3      | two waves for 5 voids; the parallel run shows 10 concurrent calls cost 6 to 20 times one call, so a small bound keeps the tail down |
| maxVoidResumes    | 5      | a void that fails five resumes goes to review instead of looping                                                                    |
| unknownDeadlineMs | 600000 | ten minutes for an unknown capture outcome before review (R-PAY-053)                                                                |

## Run entries

`gates/summarize.ts` in `packages/payments` appends one entry per gate run below this line in the format of SPEC 7.2 (operator, date, script sha, buyer kinds without credentials, observed rows, evidence path with its sha256, decision, fallback adopted, spec tags flipped). The status blocks above change only after the matching entry exists.

## Sandbox environment (required before any gate runs)

The gate workflows (`.github/workflows/gate-g0.yml`, `gate-g1.yml`, `gate-g3.yml` and
`gate-g4.yml`) declare `environment: sandbox-nightly` and only run from `main`. The environment
does not exist until the owner creates it, so until then those jobs wait or fail. The repository owner must create that
environment once:

1. Settings, Environments, New environment, name `sandbox-nightly`.
2. Add a required reviewer and limit deployment branches to `main`.
3. Add these four secrets to the environment: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
   `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD`.
4. Delete the repository-level copies of the same four secrets, so a workflow on any other branch
   cannot read them.

`packages/payments/src/gates-result.json` flags (`g1_remainder_mode`, `g2_card_authorize`,
`g4_webhooks_verified`) may leave their safe value only while the matching section above is
closed with an Evidence line; `test/gates/gatesResultEvidence.test.ts` fails otherwise, and also
when the evidence file no longer matches its recorded sha256.

The sandbox accounts must be US accounts. PayPal rejects INR orders for the sandbox buyers with `422 CURRENCY_NOT_SUPPORTED`, and India sandbox buyers fail at the buyer approval page with USD. Gates send USD by default; set `GATE_CURRENCY` only to override it for a specific run.

Until the environment exists, GitHub creates it on first use with no reviewer and no branch rule,
so do not run a gate before step 2 is done. The gate workflows are manual and main-only, so CI is
not affected in the meantime.
