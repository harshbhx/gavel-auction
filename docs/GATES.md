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

Status: NOT RUN
Run date / by: n/a
Question: does signature verification against the sandbox webhook id accept real events and reject tampered ones?
Setup: n/a
Requests: n/a
Observed: n/a
Verdict: n/a
Decision: n/a
Fallback if FAIL: confirm event state by fetching the resource from the API before acting on it.
Links: n/a

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

The gate workflows (`.github/workflows/gate-g0.yml` and `.github/workflows/gate-g1.yml`) declare
`environment: sandbox-nightly` and only run from `main`. The repository owner must create that
environment once:

1. Settings, Environments, New environment, name `sandbox-nightly`.
2. Add a required reviewer and limit deployment branches to `main`.
3. Add these four secrets to the environment: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
   `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD`.
4. Delete the repository-level copies of the same four secrets, so a workflow on any other branch
   cannot read them.

The sandbox accounts must be US accounts. PayPal rejects INR orders for the sandbox buyers with `422 CURRENCY_NOT_SUPPORTED`, and India sandbox buyers fail at the buyer approval page with USD. Gates send USD by default; set `GATE_CURRENCY` only to override it for a specific run.

Until the environment exists, GitHub creates it on first use with no reviewer and no branch rule,
so do not run a gate before step 2 is done. The gate workflows are manual and main-only, so CI is
not affected in the meantime.
