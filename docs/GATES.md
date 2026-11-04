# Gates

A gate is CLOSED only when Status is PASS or FAIL with a recorded Decision. PARTIAL stays open.
A gate without evidence reads NOT RUN. PASS, PARTIAL and FAIL need an Evidence line.

## G1: partial capture and remainder release

Status: NOT RUN
Run date / by: n/a
Question: after authorize 50000 and capture 35000 with final_capture=true, is the 15000 remainder released or still active?
Setup: n/a
Requests: n/a
Observed: n/a
Verdict: n/a
Decision: n/a
Fallback if FAIL: capture the winning price and void the authorization explicitly.
Links: n/a

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
