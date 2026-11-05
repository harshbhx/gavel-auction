# SPEC-payments: packages/payments

Owner area: payments (PAY). Status: draft v1, 2026-11-04. Sandbox only.
Companion files: `issues-payments.json`, `DEPS.md`. Reference implementation: `reference/python/fake_paypal.py`, `reference/python/saga.py`, `reference/python/test_saga.py`.

Tag convention. Anything about PayPal behaviour that has not been observed in our sandbox is tagged `UNVERIFIED (G1..G5)` and is followed by `Fallback:`. Anything without a tag is either our own design decision or a PayPal fact already relied on in the plan (OAuth, Orders v2 intent AUTHORIZE, Payments v2 capture/void/reauthorize, `PayPal-Request-Id`). When a gate passes, the tag is flipped in this file by issue PAY-70.

## 1. Purpose and scope

GAVEL backs every bid with a PayPal authorization hold. `packages/payments` is the only place that talks to PayPal and the only place that moves money. It provides:

1. A typed PayPal REST client (OAuth, Orders v2, Payments v2) with retries, idempotency and error mapping.
2. The contract with the web app for the JS SDK v6 approval flow that produces a hold.
3. The settlement saga: a persisted state machine that captures the winner at the clearing price, voids every other hold, falls back to the runner-up when the winner's hold is invalid, and resumes after a crash at any step.
4. Webhook signature verification, de-duplication and out-of-order handling.
5. Reconciliation of our ledger against PayPal.
6. A fake PayPal server (HTTP, with fault injection) so every test above runs without the network.
7. Gate scripts G1-G4 with an evidence log format, plus rate-limit and latency measurement.
8. Safety: sandbox-only guard, demo ceiling cap, kill switch.

Out of scope: the auction rules (engine), HTTP/WebSocket hosting and SQL adapters (server), React components (web), STT and parsing (voice), refunds and disputes (documented boundary only, PAY-69), real-money operation of any kind.

## 2. Definitions

| Term             | Meaning                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hold             | A PayPal authorization created for one bidder in one auction for the bidder's ceiling (integer cents, USD).                                                                              |
| Ceiling          | The authorized amount. The engine guarantees a bid never exceeds it.                                                                                                                     |
| Hammer price     | Clearing price chosen by the engine (can be below the winner's ceiling).                                                                                                                 |
| Candidate        | `(bidderId, holdId, priceCents)`; the engine ranking produces an ordered list. First is the winner at the hammer price, the rest are runner-ups each priced at their own rule (see 6.3). |
| Settlement       | The persisted record that drives capture and void for one auction.                                                                                                                       |
| Journal          | Durable settlement record plus append-only step history (Section 6.2).                                                                                                                   |
| Intent           | A write-ahead entry saved before any money-moving call.                                                                                                                                  |
| Definite outcome | The call was answered with a 4xx other than 408/429, or a 2xx. The server did or did not apply it, and we know which.                                                                    |
| Unknown outcome  | Timeout, connection reset, 5xx, or 429 after retries. The call may or may not have been applied.                                                                                         |
| Truth check      | A read (`GET authorization`, `GET order`) used to decide what really happened.                                                                                                           |
| Gate             | A sandbox experiment G1..G5 that verifies an assumption. Payments owns G1-G4. G5 (STT) belongs to voice.                                                                                 |

## 3. Requirements

IDs are stable. MUST = release blocker for the demo. SHOULD = expected, can slip with a note in the PR.

### 3.1 Safety, configuration, guard

- R-PAY-001 MUST: Configuration is read from environment variables only: `PAYPAL_ENV` (must equal `sandbox`), `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_BASE_URL` (default `https://api-m.sandbox.paypal.com`), `GAVEL_MAX_CEILING_CENTS` (default 25000), `GAVEL_PAYMENTS_FAKE` (`1` selects the fake base URL), `GAVEL_HOLD_MAX_AGE_MS` (default 7200000). Names only appear in `.env.example`; no values in the repo.
- R-PAY-002 MUST: The sandbox guard runs at construction of every gateway and refuses (throws `PaymentsConfigError`, code `payments_not_sandbox`) when: `PAYPAL_ENV` is not exactly `sandbox`; the base URL host is not exactly `api-m.sandbox.paypal.com` and not a loopback host (`127.0.0.1`, `localhost`, `::1`) with `GAVEL_PAYMENTS_FAKE=1`; the base URL scheme is not `https` for the sandbox host.
- R-PAY-003 MUST: The guard also validates every `rel=approve` link returned by Orders: host must be `www.sandbox.paypal.com` (or the fake host); otherwise the order is discarded and an error is raised.
- R-PAY-004 MUST: The guard never claims to detect live credentials by their shape (sandbox and live client ids are not distinguishable by format). Protection is host allow-list plus the first token response: a token obtained from the sandbox host is the only credential path.
- R-PAY-005 MUST: Ceiling requests above `GAVEL_MAX_CEILING_CENTS` or at or below 0 are refused before any PayPal call (`ceiling_out_of_range`). Currency is always `USD`.
- R-PAY-006 MUST: A kill switch (Section 3.9) blocks money-moving calls. Void and read calls are never blocked by it.
- R-PAY-007 MUST: Secrets (client secret, access token, `Authorization` header, webhook transmission signature) never appear in logs, errors, journal rows or evidence files. A redaction function is applied at the single logging choke point (R-PAY-130).

### 3.2 PayPal client

- R-PAY-010 MUST: OAuth client-credentials token (`POST /v1/oauth2/token`, HTTP Basic, `grant_type=client_credentials`) is cached in memory until `expires_in - 60 s`, refreshed single-flight (concurrent callers share one in-flight refresh), and refreshed once and replayed on a 401 from a business call. A second 401 is surfaced as `auth_failed`.
- R-PAY-011 MUST: Orders v2: `createOrder({holdId, ceilingCents, description})` posts `intent: "AUTHORIZE"` with one purchase unit (`reference_id` and `custom_id` = holdId, amount `{currency_code:"USD", value:"<dollars.cents>"}`); `getOrder(orderId)`; `authorizeOrder(orderId)` returns the authorization id from `purchase_units[0].payments.authorizations[0].id`.
- R-PAY-012 MUST: Payments v2: `getAuthorization(authId)`, `capture(authId, {amountCents, finalCapture, invoiceId})`, `voidAuthorization(authId)`, `reauthorize(authId, {amountCents})`.
- R-PAY-013 MUST: Every POST sends a `PayPal-Request-Id` header. The id is a deterministic function of `(auctionId, op, holdId, amountCents, generation)` (Section 4.4), at most 64 characters. UNVERIFIED (G1): the maximum accepted length and the retention window of request ids. Fallback: the saga never relies on request-id replay for correctness; truth checks decide (R-PAY-050).
- R-PAY-014 MUST: All retries of one logical attempt reuse the same `PayPal-Request-Id`. A new id is minted only when parameters change (generation + 1), never because of a retry or a resume.
- R-PAY-015 MUST: Retry policy: retry on network error, timeout, 429, 500, 502, 503, 504. Exponential backoff with full jitter: delay = random(0, min(capMs, baseMs \* 2^attempt)), defaults baseMs 250, capMs 4000, maxAttempts 4. `Retry-After` (seconds or HTTP date) overrides the computed delay when larger, bounded by 30 s. Randomness and sleep are injectable.
- R-PAY-016 MUST: Per-request timeout default 10 s, injectable. A timeout is classified as unknown outcome for POSTs and as transient for GETs.
- R-PAY-017 MUST: Error mapping (Section 4.3) returns a `PayPalError` with `kind`, `status`, `name`, `issue`, `debugId` (from the `PayPal-Debug-Id` response header or body `debug_id`), `message`, `outcome: "definite" | "unknown"`. Unknown PayPal error names on 4xx map to `kind: "rejected"` with `outcome: "definite"`.
- R-PAY-018 MUST: The client never throws raw `fetch` errors or strings; the saga catches only `PayPalError`.
- R-PAY-019 SHOULD: Every response's `PayPal-Debug-Id` and latency are passed to the observability sink (R-PAY-131).
- R-PAY-020 MUST: Amounts are converted with a pure function pair `centsToDecimal(1050) = "10.50"` and `decimalToCents("10.50") = 1050`; inputs that are not integers, negative, or have more than 2 decimals throw. No floating-point arithmetic on money anywhere in the package.
- R-PAY-021 MUST: The client exposes a single interface `PaymentsGateway` (Section 5.1). `PayPalGateway` (real HTTP) and `FakeGateway` (in-process) both implement it; the fake HTTP server is exercised through `PayPalGateway`, so the real client code runs in tests.

### 3.3 Hold lifecycle and the web approval contract

- R-PAY-030 MUST: Holds follow this server-side flow: (1) web asks the server for a hold order; (2) server calls `createOrder`; (3) web runs SDK v6 approval with that order id; (4) on approval web tells the server; (5) server calls `authorizeOrder`, stores `authId`, ceiling, bidder, auction, `createdAtMs`; (6) hold status becomes `HELD`. The server never trusts an `authId` or amount sent by the browser.
- R-PAY-031 MUST: The ceiling is chosen by the browser from presets but the amount sent to PayPal is computed server-side from `ceilingCents` validated against R-PAY-005 and the auction's allowed presets (passed in by the caller).
- R-PAY-032 MUST: `HoldService.createHoldOrder` is idempotent per `(auctionId, bidderId)`: a second call while a non-expired PENDING order exists returns the same `orderId`; after `HELD` it returns `409 hold_exists` (error code `hold_exists`).
- R-PAY-033 MUST: `HoldService.completeApproval({orderId})` is idempotent: repeated calls after success return the same hold and make no second `authorize` call (same request id plus local state).
- R-PAY-034 MUST: A hold created more than `GAVEL_HOLD_MAX_AGE_MS` before the settlement start is flagged `stale`. Stale holds are still captured (R-PAY-072) but the flag is audited. Default 2 hours is deliberately far below the 3-day honor period in the docs. UNVERIFIED (G3): the honor period and validity (3-day vs 29-day).
- R-PAY-035 MUST: Web contract objects are zod schemas exported from `packages/payments/src/contract/web.ts` and used by the server route handlers and the web client (Section 5.3). Error codes: `ceiling_out_of_range`, `hold_exists`, `order_not_found`, `order_not_approved`, `paypal_unavailable`, `kill_switch_engaged`, `payments_not_sandbox`.
- R-PAY-036 MUST: SDK v6 specifics (client token acquisition, `findEligibleMethods`, `createPayPalOneTimePaymentSession`, `presentationMode`, callbacks) are described in the contract document with the tag `UNVERIFIED (G2)`; the contract between web and server (3.3 items 1-6) is independent of SDK details. Fallback: PayPal-wallet buyers only (sandbox personal accounts); the server contract does not change.
- R-PAY-037 SHOULD: Guest card checkout with intent AUTHORIZE is only advertised in the UI if gate G2 passed (`GATES.md` flag `g2_card_authorize: true` read at build time from `packages/payments/src/gates-result.json`).
- R-PAY-038 MUST: Hold status vocabulary (separate from the settlement states of 3.4): `PENDING_APPROVAL`, `HELD`, `CAPTURED`, `VOIDED`, `EXPIRED`, `DENIED`, `UNKNOWN`. Mapping into settlement-level display is in Section 6.4.

### 3.4 Settlement state machine

- R-PAY-040 MUST: Settlement states are exactly: `HELD`, `BIDDING`, `WINNER_SELECTED`, `CAPTURING`, `CAPTURED`, `VOIDING`, `SETTLED`, `FALLBACK_RUNNER_UP`, `FAILED_NEEDS_REVIEW`. Allowed transitions are the table in Section 6.1; any other transition throws `IllegalTransition` and is a test failure.
- R-PAY-041 MUST: The transition function `step(journal, event) -> {journal, effects}` is pure: no I/O, no clock, no randomness. Effects are data (`{op:"capture", ...}`), executed by the runner.
- R-PAY-042 MUST: Every state change is persisted (compare-and-swap on `version`) before the next effect is executed. After any crash, `resume(auctionId)` produces the same outcome as an uninterrupted run (R-PAY-060).
- R-PAY-043 MUST: Terminal states are `SETTLED` and `FAILED_NEEDS_REVIEW`. Running a terminal settlement is a no-op returning the journal.
- R-PAY-044 MUST: A settlement for an auction is created once (`createSettlement` is idempotent on `auctionId`); a second plan with different candidates is rejected (`plan_mismatch`).
- R-PAY-045 MUST: Only one runner executes a settlement at a time (lease with expiry in the journal store, default 30 s, renewed per step). A second `run` while a lease is live returns `busy`.

### 3.5 Settlement saga behaviour

- R-PAY-050 MUST: Before any capture the runner performs a truth check on the candidate's hold (`getHoldTruth`). If the intent log or the truth shows a capture already applied for this auction and hold, the capture is adopted, never repeated.
- R-PAY-051 MUST: The capture request is `amountCents = candidate.priceCents`, `finalCapture = true`, `invoiceId = "gavel-<auctionId>-<holdId>"` (so the capture is findable on the order). VERIFIED (G1, sandbox 2026-11-04, wallet buyer): `invoice_id` is accepted on capture and echoed on `GET order`. Fallback kept for card buyers (untested): identify by amount plus capture time window plus our intent timestamp.
- R-PAY-052 MUST: Invariant guard before every capture: `priceCents <= ceilingCents` of that hold and `priceCents >= reserveCents`. Violation throws `SagaInvariantError` and moves to `FAILED_NEEDS_REVIEW` without any PayPal call. A candidate below reserve is skipped (cursor + 1).
- R-PAY-053 MUST: Definite capture failure (4xx other than 408/429) triggers the verify-before-fallback rule: truth check must confirm the hold is not captured; only then move to `FALLBACK_RUNNER_UP` with the next candidate. If the truth shows `CAPTURED`, adopt instead.
- R-PAY-054 MUST: Unknown capture outcome (timeout, 5xx, 429 after retries) NEVER leads to the next candidate. The settlement stays `CAPTURING` with `unknownSince` set; the runner returns `pending`; resume re-runs the truth check first.
- R-PAY-055 MUST: If the outcome stays unknown longer than `unknownDeadlineMs` (default 600000) the settlement moves to `FAILED_NEEDS_REVIEW` with reason `capture_outcome_unknown`; no fallback, no voids of the candidate in doubt. Other holds are left alone (they are released by PayPal expiry or by a manual action after review).
- R-PAY-056 MUST: After capture is confirmed, state is `CAPTURED` (journal saved with `captureId`, `capturedCents`). Then state `VOIDING`.
- R-PAY-057 MUST: Void phase voids every hold of the auction except the winner's, including holds whose capture failed definitely and holds of skipped candidates. Each void has its own request id and journal entry. Order: sorted by `bidderId` for deterministic journals; execution concurrency default 3 (`voidConcurrency`), journal writes serialized.
- R-PAY-058 MUST: A void answered with "already voided" or "expired" (mapped kinds `already_voided`, `expired`) counts as released. Any other definite error on void is retried once after a truth check; if the truth shows the hold still live the void is recorded `VOID_FAILED` and retried on resume. After `maxVoidResumes` (default 5) the settlement moves to `FAILED_NEEDS_REVIEW` with reason `void_failed:<bidderId>`.
- R-PAY-059 MUST: Winner remainder policy: after `CAPTURED`, truth check the winner's authorization. If it reports `CAPTURED` the remainder is released and nothing else is done. If it still reports an open remainder, explicitly void it and record `remainder_voided`. VERIFIED (G1, sandbox 2026-11-04, wallet buyer only): after `final_capture=true` the authorization reads `CAPTURED` and the order `COMPLETED`, so the remainder is released without a void (decision A). An explicit void after that answers 422 `PREVIOUSLY_CAPTURED`, which counts as released. Card buyers are untested; the explicit-void branch stays implemented and tested against the fake in both modes (`autoReleaseRemainder: true | false`) as the fallback.
- R-PAY-060 MUST: Crash-resume equivalence: for every journal label boundary `L` (`journaled:*`, `before:*`, `after:*`), crashing at `L` and resuming yields the same final state, the same set of capture/void effects on the fake, and invariants hold (R-PAY-061).
- R-PAY-061 MUST: Invariants (checked on the fake after every saga test and in the reconciler on the sandbox): at most one capture per auction; captured amount <= ceiling of that hold; captured amount equals the settled price; each non-winner hold has at most one effective void; no capture after a void on the same hold; captured + released = sum of holds at settlement end.
- R-PAY-062 MUST: No sale (no candidate or all below reserve): every hold voided, `SETTLED` with `winner = null`.
- R-PAY-063 MUST: Kill switch engaged mid-settlement: the runner stops before the next capture or reauthorize, returns `pending` with reason `kill_switch`, and keeps the state. Voids continue (R-PAY-006).
- R-PAY-064 MUST: The runner emits `settlement_update` payloads (Section 5.4) after each persisted transition and `audit_event` payloads for each money call (request id, attempt, outcome).
- R-PAY-065 SHOULD: `FALLBACK_RUNNER_UP` is visible in `settlement_update` with `fromBidderId`, `toBidderId`, `reason` so the UI can show it.

### 3.6 Reauthorize (conditional)

- R-PAY-070 MAY be enabled only when gate G3 shows a need. Default: `reauth.enabled = false`; the demo creates holds minutes before capture and the stale flag (R-PAY-034) is the only control. Reauthorization is an explicit call (`reauthorizeIfDue`) only: the capture, void and hold phases never call it, so `enabled` does not change a settlement by itself (R8-P08). The caller persists the result and runs the call before the capture.
- R-PAY-071 MUST (when enabled): an explicit reauthorization call attempts it only when hold age is greater than `honorSafeMs` (default 3 days minus 6 hours), amount never above the original ceiling, one request id per generation, and the new ceiling and `startedAtMs` are persisted. UNVERIFIED (G3): the day 4..29 window and the 115% / $75 limit used by the prototype.
- R-PAY-072 MUST: A stale or reauthorized hold is captured exactly like a fresh one; there is no code path that skips capture because of age. If PayPal rejects, the normal definite-failure path (R-PAY-053) applies.

### 3.7 Webhooks

- R-PAY-090 MUST: Webhook intake signature verification uses `POST /v1/notifications/verify-webhook-signature` with headers `PAYPAL-AUTH-ALGO`, `PAYPAL-CERT-URL`, `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-TRANSMISSION-TIME`, our `webhook_id`, and the event. Result `verification_status === "SUCCESS"` is the only accept.
- R-PAY-091 MUST: The event is embedded into the verification request as the original raw body text (string splicing, no parse and re-serialize), so the bytes PayPal signed are the bytes PayPal verifies. UNVERIFIED (G4): whether re-serialization would also pass. Fallback: keep raw splicing regardless.
- R-PAY-092 MUST: The route handler passes the raw body (Buffer) and headers; a handler that has already parsed JSON is a bug (the server owner configures raw-body capture; see PAY-46 contract test).
- R-PAY-093 MUST: Failed verification returns 401 to the sender, stores an audit row `webhook_rejected` (no state change), and never touches settlement or hold state.
- R-PAY-094 MUST: De-duplication by PayPal event `id`: insert-if-absent into `WebhookEventStore`; duplicates return 200 immediately with no effect.
- R-PAY-095 MUST: Webhooks are hints, not the source of truth. A verified event maps to a `HoldHint {holdId|authId|captureId, kind}`; the processor responds by calling `observeHold(holdId)` (truth check) and merging monotonic status (Section 6.5). The event body's amounts are never written to the ledger directly.
- R-PAY-096 MUST: Out-of-order and early delivery are safe: an event for a hold we do not know yet is parked (`orphan`, retried by `sweepOrphans` for 10 minutes); a `CAPTURE.COMPLETED` arriving before the saga recorded the capture marks the hold `observed_captured`, and the saga adopts it at its next truth check.
- R-PAY-097 MUST: Status merge is monotonic: `PENDING_APPROVAL < HELD < CAPTURED`, and `VOIDED`, `EXPIRED`, `DENIED` are terminal. A transition between conflicting terminals (for example `CAPTURED` then `VOIDED`) is not applied and raises a `status_conflict` audit event and a reconciliation flag.
- R-PAY-098 MUST: Event types handled: `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.PENDING`, `CHECKOUT.ORDER.APPROVED`. Unknown types are stored and acknowledged (200). VERIFIED (G4, 2026-11-05): names and shapes of CHECKOUT.ORDER.APPROVED, PAYMENT.AUTHORIZATION.CREATED, PAYMENT.AUTHORIZATION.VOIDED and PAYMENT.CAPTURE.COMPLETED are recorded in test/fixtures/webhooks; DENIED and PENDING stay UNVERIFIED. Fallback: polling reconciliation (R-PAY-100) covers every transition.
- R-PAY-099 MUST: The processor responds within 2 s; heavy work (truth checks) runs after the response is queued, but the event row is durably stored before 200 is returned.

### 3.8 Reconciliation

- R-PAY-100 MUST: `reconcile(auctionId)` loads the journal and, for each hold, the truth, then returns a report of findings: `MISSING_CAPTURE` (journal says captured, PayPal does not), `EXTRA_CAPTURE` (PayPal captured, journal does not know), `AMOUNT_MISMATCH`, `LIVE_HOLD_AFTER_SETTLED`, `STATUS_DRIFT`, `STATUS_CONFLICT`, `UNOBSERVABLE`.
- R-PAY-101 MUST: The reconciler is read-only by default. With `repair: "void_live_holds"` it may void holds that are live after `SETTLED`; it never captures and never edits the journal's money fields.
- R-PAY-102 SHOULD: `reconcileAll({sinceMs})` runs on a timer (default every 60 s while any settlement is non-terminal) and on demand from the auctioneer console route.
- R-PAY-103 MUST: Reports are JSON, stable ordering (by finding code, then bidderId), and include `observedAt`, so two runs on unchanged state are equal except for the timestamp.

### 3.9 Kill switch

- R-PAY-110 MUST: Interface `KillSwitch { isEngaged(): Promise<KillState>; engage(reason, by): Promise<void>; release(by): Promise<void> }`. State is persisted (survives restart) via the journal store family.
- R-PAY-111 MUST: Engaged: `createOrder`, `authorizeOrder`, `capture`, `reauthorize` throw `kill_switch_engaged` before touching the network. `voidAuthorization` and all reads still work.
- R-PAY-112 MUST: `voidAllLiveHolds(auctionId)` is a separate explicit admin operation (not triggered by engage) that voids every hold not captured, with audit events.
- R-PAY-113 MUST: Engage and release are audited with the actor.

### 3.10 Fake PayPal server

- R-PAY-120 MUST: `packages/payments/src/fake` provides `FakePayPalCore` (pure in-memory state machine, port of `fake_paypal.py`, plus orders) and `FakePayPalServer` (HTTP, listens on an ephemeral port) implementing: `POST /v1/oauth2/token`, `POST /v2/checkout/orders`, `GET /v2/checkout/orders/{id}`, `POST /v2/checkout/orders/{id}/authorize`, `GET /v2/payments/authorizations/{id}`, `POST /v2/payments/authorizations/{id}/capture`, `.../void`, `.../reauthorize`, `POST /v1/notifications/verify-webhook-signature`.
- R-PAY-121 MUST: Control surface under `/__fake/*` (never exposed by the real client): `POST /__fake/approve/{orderId}` (simulates the buyer), `POST /__fake/clock/advance`, `POST /__fake/inject`, `POST /__fake/webhooks/deliver`, `GET /__fake/state`, `GET /__fake/invariants`, `POST /__fake/reset`.
- R-PAY-122 MUST: Fault kinds (Section 4.5): `timeout_before`, `timeout_after_success`, `http_500`, `http_429` (with `Retry-After`), `http_401_once`, `connection_reset`, `slow(ms)`, `capture_declined`, `malformed_body`, `forget_idempotency`. A fault targets `(op, authId|null, times)` and an optional `afterNthCall`.
- R-PAY-123 MUST: Idempotency semantics match the reference implementation: same `(op, authId, PayPal-Request-Id)` with equal params replays the stored result; with different params returns 422 `DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS`. The error name is `[assumed]` (UNVERIFIED (G1)); the client does not branch on it beyond `kind: "idempotency_conflict"`.
- R-PAY-124 MUST: The fake has `Clock` injection: honor period (default 3 d), validity (default 29 d), `afterHonorCapture: "ok" | "fail"`, `autoReleaseRemainder: boolean`, over-capture cap function `min(115%, +$75)` as configurable `captureLimit(hold)`; all are marked as assumptions in `fake/ASSUMPTIONS.md` with the gate that will confirm each.
- R-PAY-125 MUST: Seeded determinism: same seed and same call sequence produce identical ids and webhook order. Ids are sequential per kind (`AUTH-1`), not random.
- R-PAY-126 MUST: Webhook delivery modes: `fifo`, `reverse`, `shuffle(seed)`, `duplicate`, `drop(ids)`, `delay(ms)`. Events are signed with a fake scheme understood by the fake verify endpoint (HMAC over transmission id, time, webhook id and raw body with a fixed test key).
- R-PAY-127 MUST: `check_invariants` from the reference implementation is ported as `core.checkInvariants()` and called by the shared test helper `assertFakeInvariants(core)` after each saga test.
- R-PAY-128 SHOULD: A conformance suite (PAY-55) runs the same assertions against the fake and, when `PAYPAL_ENV=sandbox` credentials are present and the job is the manual workflow, against the real sandbox; differences are recorded in `ASSUMPTIONS.md`.

### 3.11 Observability

- R-PAY-130 MUST: One logging function `logPayment(event)` is the only way payments code logs; it applies redaction and writes a JSON line: `{ts, level, auctionId?, holdId?, op, requestId, attempt, status, debugId, latencyMs, outcome, kind?}`.
- R-PAY-131 MUST: In-process counters and histograms behind a `PaymentsMetrics` interface: `paypal_calls_total{op,outcome}`, `paypal_latency_ms{op}`, `paypal_retries_total{op}`, `settlement_transitions_total{from,to}`, `webhook_events_total{result}`, `reconcile_findings_total{code}`. In-memory implementation plus a text snapshot function used by the ops page.
- R-PAY-132 MUST: The `AuditSink` receives one entry per money call and one per state change, with a hash-chain-friendly canonical JSON form (sorted keys) so the engine's ledger can chain it.

### 3.12 Gates and measurement

- R-PAY-140 MUST: Gate scripts live in `packages/payments/gates/` and use their own thin recording HTTP layer (not the production client), so they independently check PayPal behaviour and the client. Run with `npm run gate:g1 -w @gavel/payments` etc.; each accepts `--fake` (runs against the fake, used in CI to keep scripts working) and `--resume <runfile>`.
- R-PAY-141 MUST: Every gate step writes evidence records in the format of Section 7 and a final summary appended to `docs/GATES.md` by `npm run gate:summarize`.
- R-PAY-142 MUST: Gate scripts refuse to run unless the sandbox guard passes (same code as R-PAY-002).
- R-PAY-143 MUST: G1: authorize 500 cents, capture 350 with `final_capture=true`, observe the 150 remainder via `GET authorization` and `GET order`, attempt explicit void, repeat for a PayPal-wallet buyer and a card-funded buyer. Output: decision A, B or C (Section 7.3).
- R-PAY-144 MUST: G2: a minimal page using SDK v6 creates an order with intent AUTHORIZE and completes the buyer approval for (a) PayPal wallet, (b) guest card if the SDK offers it. Output: order ids, authorization ids, screenshots, pass/fail per path.
- R-PAY-145 MUST: G3: immediate reauthorize attempt (records the error name), plus a timed probe created on day 0 with three authorizations captured, reauthorized and left alone at day 3.5 / 4 / 5 (runs scripted via GitHub Actions `schedule` or manual dispatch). Output: documented honor and validity behaviour and the rule for R-PAY-034 and R-PAY-070.
- R-PAY-146 MUST: G4: receive real sandbox webhooks for capture and void, verify signatures through R-PAY-090, and record that simulator-produced events fail verification (or not). Output: event names and shapes (sanitized fixtures committed to `packages/payments/test/fixtures/webhooks/`). DONE (G4 PASS, 2026-11-05).
- R-PAY-147 MUST: Measurement script `npm run measure` performs 50 sequential and 10 parallel authorize/capture/void cycles, records p50/p95/p99 latency per op, count of 429 and `Retry-After` values, and writes `docs/evidence/measure/<run>.json` and a table in `docs/GATES.md`.
- R-PAY-148 MUST: Any gate that fails with no workaround triggers the plan's decision path: the issue is labelled `blocked:needs-owner` with the evidence link and the fallback named in this spec.

### 3.13 Non-functional

- R-PAY-150 MUST: Determinism: with injected clock, rng and sleep, a saga run is reproducible (same journals byte for byte).
- R-PAY-151 MUST: No network access in unit tests; the fake HTTP server binds to `127.0.0.1` on an ephemeral port.
- R-PAY-152 SHOULD: Targets (to be replaced by measured numbers from R-PAY-147): hammer to `CAPTURED` p95 under 2.5 s; hammer to `SETTLED` for 6 holds p95 under 6 s; webhook handler 200 under 300 ms excluding verify call. All UNVERIFIED (G1 measurement).
- R-PAY-153 MUST: TypeScript strict, no `any` in exported signatures, ESM, Node 20+, zero runtime dependencies except `zod` (contract) and Node built-ins (`fetch`, `crypto`).

## 4. Interfaces, mappings, algorithms

### 4.1 Settlement plan input (from engine)

```ts
export interface SettlementPlan {
  auctionId: string; // ULID
  reserveCents: number;
  candidates: Candidate[]; // best first; [0] is the hammer winner
  holds: Record<string, HoldRef>; // bidderId -> hold
}
export interface Candidate {
  bidderId: string;
  priceCents: number;
}
export interface HoldRef {
  holdId: string;
  authId: string;
  ceilingCents: number;
  createdAtMs: number;
}
```

Mapper `planFromOutcome(outcome, holds, reserve)` mirrors `ranking_from_outcome`: winner at `outcome.price`, then `outcome.ranking.slice(1)` each at its own amount. UNVERIFIED engine detail: whether runner-up price in second-price mode should equal their own best bid or the next price level; default is the prototype behaviour; decision owner engine (Open question Q3).

### 4.2 Money conversion

`centsToDecimal(35000) = "350.00"`, `centsToDecimal(5) = "0.05"`, `decimalToCents("0.5") throws` (needs 2 decimals) unless `lenient: true`. Property: for all integers n in [0, 10^9], `decimalToCents(centsToDecimal(n)) === n`.

### 4.3 Error mapping table

| Condition                                                      | `kind`                            | `outcome`                        | Saga reaction                                                  |
| -------------------------------------------------------------- | --------------------------------- | -------------------------------- | -------------------------------------------------------------- |
| network error, timeout, reset                                  | `network`                         | unknown (POST) / transient (GET) | retry, then pending                                            |
| 429                                                            | `rate_limited`                    | unknown after retries            | retry with Retry-After, then pending                           |
| 500, 502, 503, 504                                             | `server_error`                    | unknown                          | retry, then pending                                            |
| 401                                                            | `auth_expired` then `auth_failed` | definite                         | refresh once                                                   |
| 404                                                            | `not_found`                       | definite                         | truth `NOT_FOUND`; capture: fallback; void: released           |
| 400                                                            | `invalid_request`                 | definite                         | invariant failure; `FAILED_NEEDS_REVIEW`                       |
| 422 issue AUTHORIZATION_VOIDED / ALREADY_VOIDED                | `already_voided`                  | definite                         | capture: fallback; void: released                              |
| 422 issue AUTHORIZATION_EXPIRED                                | `expired`                         | definite                         | capture: fallback; void: released                              |
| 422 issue AUTHORIZATION_ALREADY_CAPTURED                       | `already_captured`                | definite                         | capture: adopt after truth; void: fine if winner else conflict |
| 422 issue INSTRUMENT_DECLINED                                  | `declined`                        | definite                         | capture: fallback                                              |
| 422 issue DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS (assumed name) | `idempotency_conflict`            | definite                         | `FAILED_NEEDS_REVIEW` (bug)                                    |
| other 4xx                                                      | `rejected`                        | definite                         | as `declined` after truth check                                |

UNVERIFIED (G1): every PayPal issue name in this table other than the HTTP statuses. The prototype names are assumptions. Fallback: classification by HTTP status class alone (4xx definite, 5xx unknown) plus the mandatory truth check before any fallback (R-PAY-053), which makes a wrong name harmless.

### 4.4 Request-id construction

```
requestId = "gv1-" + base32(sha256(`${auctionId}|${op}|${holdId}|${amountCents}|${generation}`)).slice(0, 40)
```

Length 44. `op` in `{order, authorize, capture, void, reauth}`.

### 4.5 Fault taxonomy (fake)

| Kind                  | Behaviour at the fake                                                         |
| --------------------- | ----------------------------------------------------------------------------- |
| timeout_before        | request received, not applied, connection held then dropped after `timeoutMs` |
| timeout_after_success | applied (and idempotency stored), response dropped                            |
| http_500              | not applied, 500 `INTERNAL_SERVICE_ERROR`                                     |
| http_429              | not applied, 429 with `Retry-After: n`                                        |
| http_401_once         | next business call gets 401, token endpoint then works                        |
| connection_reset      | socket destroyed immediately, not applied                                     |
| slow(ms)              | applied, response delayed                                                     |
| capture_declined      | 422 `INSTRUMENT_DECLINED`, not applied                                        |
| malformed_body        | 200 with truncated JSON, applied                                              |
| forget_idempotency    | idempotency table cleared (simulates retention expiry)                        |

### 4.6 Capture algorithm (runner, simplified)

```
for candidate at cursor:
  invariant checks (R-PAY-052)
  truth = getHoldTruth(hold)                       // retried read
  if truth.captured matches candidate price: adopt -> CAPTURED
  if truth in {VOIDED, EXPIRED, DENIED, NOT_FOUND}: record failure -> FALLBACK_RUNNER_UP
  save intent {op:capture, requestId, amount}      // write-ahead
  try capture(...)                                 // retried, same request id
    ok -> save CAPTURED
    definite failure -> truth check -> (captured? adopt : FALLBACK_RUNNER_UP)
    unknown -> save unknownSince, return pending   // never next candidate
```

## 5. Interfaces (TypeScript)

### 5.1 Gateway port

```ts
export type HoldStatus =
  | 'PENDING_APPROVAL'
  | 'HELD'
  | 'CAPTURED'
  | 'VOIDED'
  | 'EXPIRED'
  | 'DENIED'
  | 'UNKNOWN';
export interface HoldTruth {
  holdId: string;
  authId: string;
  status:
    | 'CREATED'
    | 'PENDING'
    | 'PARTIALLY_CAPTURED'
    | 'CAPTURED'
    | 'VOIDED'
    | 'EXPIRED'
    | 'DENIED'
    | 'NOT_FOUND';
  amountCents: number;
  capturedCents: number;
  captures: CaptureRef[] | null; // null = not observable (UNVERIFIED G1)
  observedAtMs: number;
}
export interface CaptureRef {
  captureId: string;
  amountCents: number;
  final: boolean;
  invoiceId?: string;
}
export interface PaymentsGateway {
  createOrder(i: {
    holdId: string;
    ceilingCents: number;
    description: string;
    requestId: string;
  }): Promise<{ orderId: string; approveUrl?: string }>;
  getOrder(orderId: string): Promise<{ orderId: string; status: string; authId?: string }>;
  authorizeOrder(
    orderId: string,
    requestId: string,
  ): Promise<{ authId: string; amountCents: number }>;
  getHoldTruth(h: { holdId: string; authId: string; orderId?: string }): Promise<HoldTruth>;
  capture(
    authId: string,
    i: { amountCents: number; finalCapture: boolean; invoiceId: string; requestId: string },
  ): Promise<{ captureId: string; amountCents: number }>;
  voidAuthorization(authId: string, requestId: string): Promise<void>;
  reauthorize(
    authId: string,
    i: { amountCents: number; requestId: string },
  ): Promise<{ amountCents: number }>;
}
export class PayPalError extends Error {
  kind: ErrorKind;
  status: number;
  name: string;
  issue?: string;
  debugId?: string;
  outcome: 'definite' | 'unknown';
}
```

### 5.2 Stores and ports

```ts
export interface JournalStore {
  load(auctionId: string): Promise<Journal | null>;
  create(j: Journal): Promise<void>; // fails if exists
  save(j: Journal, expectedVersion: number): Promise<void>; // CAS; throws VersionConflict
  acquireLease(auctionId: string, owner: string, ttlMs: number, nowMs: number): Promise<boolean>;
  releaseLease(auctionId: string, owner: string): Promise<void>;
}
export interface WebhookEventStore {
  insertIfAbsent(e: StoredWebhook): Promise<boolean>; // true = new
  markProcessed(id: string, result: string): Promise<void>;
  parkOrphan(id: string, untilMs: number): Promise<void>;
  listOrphans(nowMs: number): Promise<StoredWebhook[]>;
}
export interface HoldStore {
  get(holdId: string): Promise<HoldRecord | null>;
  byBidder(auctionId: string, bidderId: string): Promise<HoldRecord | null>;
  put(h: HoldRecord): Promise<void>;
  listByAuction(auctionId: string): Promise<HoldRecord[]>;
}
export interface AuditSink {
  append(e: PaymentAudit): Promise<void>;
}
export interface Clock {
  nowMs(): number;
}
```

The in-memory and file-backed implementations live in payments; SQL adapters are built by the realtime area against these interfaces (Open question Q2).

### 5.3 Web contract (zod, JSON)

```
POST /api/holds                       (server route, owned by realtime; handler logic in payments)
request : { "auctionId": "01JC...", "bidderId": "01JC...", "ceilingCents": 15000 }
response: { "holdId": "01JC...", "orderId": "5O190127TN364715T", "clientToken"?: "<opaque, UNVERIFIED (G2)>" }
errors  : 400 ceiling_out_of_range | 409 hold_exists | 503 paypal_unavailable | 503 kill_switch_engaged

POST /api/holds/{holdId}/approve
request : { "orderId": "5O190127TN364715T" }
response: { "holdId": "...", "status": "HELD", "ceilingCents": 15000 }
errors  : 404 order_not_found | 409 order_not_approved | 503 paypal_unavailable
```

Browser sequence (UNVERIFIED (G2) for SDK call names; the HTTP contract is fixed):

```
web                         server                       PayPal
 | POST /api/holds ---------->| createOrder(AUTHORIZE) ---->|
 |<-- {orderId} --------------|<-- order CREATED -----------|
 | SDK v6 session.start(orderId) -----------------------> buyer approves
 |<-- onApprove(orderId) ------------------------------------|
 | POST /api/holds/:id/approve>| authorizeOrder ----------->|
 |<-- {status:HELD} ----------|<-- authorization CREATED ---|
```

onCancel and onError in the browser: web calls `DELETE /api/holds/{holdId}` (abandon pending order; no PayPal call, the order simply expires). The fixture `contract/fixtures/*.json` holds one example per message for the web area's mocks.

### 5.4 Settlement payloads

```json
{
  "type": "settlement_update",
  "auctionId": "01JC...",
  "state": "FALLBACK_RUNNER_UP",
  "holds": [
    { "bidderId": "b1", "holdId": "h1", "status": "DENIED" },
    { "bidderId": "b2", "holdId": "h2", "status": "HELD" }
  ],
  "fromBidderId": "b1",
  "toBidderId": "b2",
  "reason": "declined",
  "capture": null,
  "tsMs": 1762300000000
}
```

```json
{
  "type": "audit_event",
  "auctionId": "01JC...",
  "kind": "paypal_call",
  "op": "capture",
  "holdId": "h1",
  "requestId": "gv1-...",
  "attempt": 2,
  "status": 500,
  "outcome": "unknown",
  "debugId": "abc123",
  "tsMs": 1762300000100
}
```

Payload types are re-exported by `packages/shared` wire definitions; payments owns the domain fields, realtime owns the envelope.

### 5.5 Journal (persisted JSON, version 1)

```json
{
  "v": 1,
  "auctionId": "01JC...",
  "version": 7,
  "state": "CAPTURING",
  "plan": {
    "reserveCents": 5000,
    "candidates": [
      { "bidderId": "b1", "priceCents": 22000 },
      { "bidderId": "b2", "priceCents": 21000 }
    ]
  },
  "holds": {
    "b1": { "holdId": "h1", "authId": "AUTH-1", "ceilingCents": 30000, "stale": false },
    "b2": { "holdId": "h2", "authId": "AUTH-2", "ceilingCents": 25000, "stale": false }
  },
  "cursor": 0,
  "intent": {
    "op": "capture",
    "holdId": "h1",
    "requestId": "gv1-...",
    "amountCents": 22000,
    "startedAtMs": 1762300000000
  },
  "unknownSince": null,
  "winner": null,
  "failed": [],
  "voids": {},
  "resumes": 0,
  "history": [
    {
      "seq": 1,
      "tsMs": 1,
      "from": "WINNER_SELECTED",
      "to": "CAPTURING",
      "label": "journaled:start_capture"
    }
  ]
}
```

Canonical serialization: sorted keys, no whitespace, so journals compare byte for byte.

## 6. State machines and sequences

### 6.1 Settlement states and transitions

```
HELD --start_auction--> BIDDING --hammer--> WINNER_SELECTED --begin--> CAPTURING
CAPTURING --capture_ok/adopted--> CAPTURED --begin_void--> VOIDING --all_released--> SETTLED
CAPTURING --definite_fail(+truth not captured)--> FALLBACK_RUNNER_UP --next_candidate--> CAPTURING
FALLBACK_RUNNER_UP --no_candidates_left--> VOIDING          (no sale)
WINNER_SELECTED --no_candidate--> VOIDING                   (no sale at hammer)
CAPTURING --unknown_deadline|invariant|mismatch--> FAILED_NEEDS_REVIEW
VOIDING --void_budget_exhausted--> FAILED_NEEDS_REVIEW
CAPTURED --mismatch--> FAILED_NEEDS_REVIEW
```

Explicit table (row = from, columns = allowed to): HELD:{BIDDING, VOIDING}; BIDDING:{WINNER_SELECTED, VOIDING}; WINNER_SELECTED:{CAPTURING, VOIDING, FAILED_NEEDS_REVIEW}; CAPTURING:{CAPTURED, FALLBACK_RUNNER_UP, FAILED_NEEDS_REVIEW}; FALLBACK_RUNNER_UP:{CAPTURING, VOIDING, FAILED_NEEDS_REVIEW}; CAPTURED:{VOIDING, FAILED_NEEDS_REVIEW}; VOIDING:{SETTLED, FAILED_NEEDS_REVIEW}; SETTLED:{}; FAILED_NEEDS_REVIEW:{}. HELD to VOIDING covers an auction cancelled before it started.

### 6.2 Crash labels

Boundaries, as in the prototype: `journaled:<label>`, `before:<op>`, `after:<op>` for `op` in `get, capture, void, reauth`. The harness enumerates labels by a dry run, then for each label index runs: crash, new runner from the same store, resume, assert equivalence (R-PAY-060). Variants: plus `forget_idempotency` before resume; plus `timeout_after_success` on the first capture; double crash chain.

### 6.3 Sequence: happy path with one fallback

```
hammer   runner           journal              PayPal
  |--plan->|--create----->| WINNER_SELECTED
  |        |--begin------>| CAPTURING (cursor 0, intent saved)
  |        |-- truth ----------------------------> GET auth h1  (CREATED)
  |        |-- capture h1 22000 final ------------> 422 declined
  |        |-- truth ----------------------------> GET auth h1  (CREATED, not captured)
  |        |--fail------->| FALLBACK_RUNNER_UP (failed: b1 declined)
  |        |--next------->| CAPTURING (cursor 1, intent saved)
  |        |-- capture h2 21000 final ------------> 201 COMPLETED
  |        |--save------->| CAPTURED
  |        |-- truth winner ----------------------> status CAPTURED (remainder policy)
  |        |--begin_void->| VOIDING
  |        |-- void h1, void h3 ------------------> 200 / 200
  |        |--save------->| SETTLED
```

Runner-up pricing: candidate `priceCents` is fixed by the engine at plan time (prototype: runner-up at its own best bid). The saga never recomputes prices.

### 6.4 Display mapping (hold status to ladder step for the web area)

`HELD` = "Held, not charged"; `CAPTURED` = "Charged at winning price"; `VOIDED` or `EXPIRED` = "Released"; `DENIED` = "Declined"; `UNKNOWN` = "Checking". The mapping function `ladderStep(holdStatus, settlementState)` is exported and unit-tested; web consumes it.

### 6.5 Webhook processing

```
raw body + headers --verify(API)--> FAIL --> 401, audit webhook_rejected
                                  \-> OK --> insertIfAbsent(id)
                                              dup  --> 200 (no effect)
                                              new  --> map to hint --> known hold? --yes--> observeHold (GET) --> monotonic merge --> 200
                                                                              \--no--> parkOrphan --> 200
```

Monotonic merge rank: `PENDING_APPROVAL(0) < HELD(1) < CAPTURED(2)`; `VOIDED, EXPIRED, DENIED` terminal; terminal vs different terminal = `status_conflict`.

## 7. Evidence log format (docs/GATES.md and docs/evidence)

### 7.1 Records

Each gate run writes `docs/evidence/<gate>/<runId>.jsonl`, one JSON object per line, UTF-8, sorted keys:

```json
{
  "gate": "G1",
  "runId": "G1-20261104T101500Z-wallet",
  "step": "G1.4 capture 350 final",
  "tsMs": 1762251300000,
  "request": {
    "method": "POST",
    "url": "https://api-m.sandbox.paypal.com/v2/payments/authorizations/<id>/capture",
    "headers": {
      "PayPal-Request-Id": "gate-g1-cap-1",
      "Content-Type": "application/json",
      "Authorization": "[REDACTED]"
    },
    "body": { "amount": { "currency_code": "USD", "value": "3.50" }, "final_capture": true }
  },
  "response": {
    "status": 201,
    "headers": { "PayPal-Debug-Id": "<id>" },
    "body": { "id": "<capture id>", "status": "COMPLETED" },
    "latencyMs": 812
  },
  "assertion": {
    "name": "capture completed",
    "expected": "COMPLETED",
    "actual": "COMPLETED",
    "pass": true
  },
  "buyer": "wallet",
  "env": "sandbox",
  "scriptVersion": "<git sha>"
}
```

Redaction: `Authorization`, `client_secret`, `access_token`, `PAYPAL-TRANSMISSION-SIG`, buyer passwords, full card numbers (sandbox card numbers are test data but are still removed). Account ids are kept; passwords are never stored. A lint test (T-PAY-070) fails if a record contains a token-shaped string.

### 7.2 docs/GATES.md entry template

```
## G1 partial capture and remainder  (run G1-20261104T101500Z)
Operator: <name>   Date: 2026-11-04   Env: sandbox   Script: <sha>
Buyers: wallet (<email>), card (<email>)         [no passwords]
| id | expected | actual | verdict |
|----|----------|--------|---------|
| G1.5 remainder status after final capture | open or released | <value> | observed |
Evidence: docs/evidence/G1/<runId>.jsonl (sha256 <hash>)
Decision: PASS | PASS-WITH-FALLBACK | FAIL
Fallback adopted: <text or none>
Spec tags flipped: R-PAY-059, R-PAY-051 (list)
```

### 7.3 Decision matrices

| Gate | Observation                                                                         | Decision           | Effect on code                                                                     |
| ---- | ----------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| G1   | after final capture, GET shows authorization CAPTURED and explicit void is rejected | A                  | winner remainder branch is a no-op                                                 |
| G1   | remainder still open, explicit void succeeds                                        | B                  | saga void phase includes the winner's remainder (R-PAY-059)                        |
| G1   | remainder open and void rejected                                                    | C                  | document that remainder expires on its own; UI copy "released on expiry"; escalate |
| G1   | partial capture with final_capture rejected for card buyers                         | FAIL(card)         | wallet buyers only (R-PAY-037)                                                     |
| G2   | card AUTHORIZE works in SDK v6                                                      | PASS               | enable card in UI                                                                  |
| G2   | card AUTHORIZE not offered or fails                                                 | PASS-WITH-FALLBACK | wallet only; copy changes                                                          |
| G3   | capture after day 3 succeeds                                                        | PASS               | no reauth; keep stale flag                                                         |
| G3   | capture after day 3 fails, reauth works                                             | PASS-WITH-FALLBACK | enable R-PAY-070                                                                   |
| G3   | both fail                                                                           | FAIL               | demo holds minutes before capture; document                                        |
| G4   | real events verify, simulator events fail                                           | PASS               | as designed                                                                        |
| G4   | no public URL or verify fails                                                       | PASS-WITH-FALLBACK | polling reconciliation only; webhook ticks in UI come from our own observations    |

## 8. Error and edge cases

1. Browser approves, then closes the tab before `POST /approve`: order is APPROVED at PayPal, no hold. `HoldService.recover(orderId)` (called by a sweep and by the next `createHoldOrder`) checks the order and authorizes it if the auction is still open, else abandons it (no money moved until authorize).
2. Double click on approve: R-PAY-033.
3. `authorize` succeeds at PayPal but our response is lost: retried with the same request id; if PayPal rejects the replay, `getOrder` shows the authorization id and we adopt it.
4. Winner and runner-up are the same bidder: refused (`plan_invalid`).
5. Ceiling equals price: capture amount equals hold amount; fine. Price above ceiling: `SagaInvariantError` before PayPal.
6. Process crashes after capture succeeded but before the journal save: resume finds intent present, truth shows `CAPTURED` with matching amount, adopts (Section 4.6).
7. Capture succeeded, then the webhook says VOIDED for the same hold: `status_conflict`, reconciliation flag, no state change.
8. Clock skew: the saga uses an injected `Clock`; lease and deadlines use journal timestamps from that clock only.
9. A hold voided by the buyer in their PayPal account mid-auction: surfaced by webhook hint and by the pre-capture truth check; if it is the winner, definite failure path; the engine is told by `settlement_update` (reason `hold_voided`).
10. Zero candidates and holds exist: all voided, `SETTLED`, `winner: null`.
11. Two runners racing: lease (R-PAY-045); the loser returns `busy`; CAS on `version` prevents both writing.
12. Journal store unavailable: runner throws `JournalUnavailable` before any PayPal call; no money call is ever made without a persisted intent.
13. PayPal returns 200 with a body missing the id: `malformed_body` -> treated as unknown outcome for POSTs, truth check resolves.
14. Token endpoint down: calls fail with `auth_failed`/transient; saga pending; no fallback.
15. Capture amount of 0 or negative: rejected before the call.

## 9. Non-functional

- Latency: see R-PAY-152; measured numbers replace targets after PAY-64.
- Determinism: R-PAY-150; randomness only in jitter, injected.
- Security: secrets only in env; redaction at the logging choke point; webhook route verifies before any state change; request ids contain no personal data; sandbox guard; ceiling cap.
- Concurrency: one runner per settlement (lease); void concurrency bounded; token refresh single-flight.
- Memory and size: journals under 16 KB for 100 holds; history capped at 500 entries (older entries summarized).
- Dependency policy: no PayPal SDK; REST via fetch, so behaviour is visible and fakeable.
- Accessibility: payments has no UI; display strings for the ladder are provided as keys with plain-text labels (6.4) so the web area can add screen-reader text.

## 10. Test specification

Test runner: vitest in `packages/payments`; all heavy runs in GitHub Actions (`payments-ci`). Fixtures in `packages/payments/test/fixtures/`.

### 10.1 Unit tests

| ID        | Requirements        | Input                                                                                                                                                   | Expected                                                                                        |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| T-PAY-001 | R-PAY-020           | `centsToDecimal` for 0, 5, 100, 1050, 35000, 999999999                                                                                                  | "0.00","0.05","1.00","10.50","350.00","9999999.99"                                              |
| T-PAY-002 | R-PAY-020           | property: 1000 random integers round-trip; non-integers, negatives, "1.234", "1,5", ""                                                                  | round-trip holds; the invalid inputs throw                                                      |
| T-PAY-003 | R-PAY-001, 002      | env: PAYPAL_ENV=live; base url https://api-m.paypal.com; host with sandbox as subdomain suffix attack `api-m.sandbox.paypal.com.evil.test`; http scheme | each throws `payments_not_sandbox`                                                              |
| T-PAY-004 | R-PAY-002, 004      | loopback base URL without `GAVEL_PAYMENTS_FAKE=1`; with it                                                                                              | throws; allowed                                                                                 |
| T-PAY-005 | R-PAY-003           | order response whose approve link host is `www.paypal.com`                                                                                              | order discarded, error raised                                                                   |
| T-PAY-006 | R-PAY-005, 031      | ceilings 0, -1, 25001 (cap 25000), 25000, 1                                                                                                             | refused, refused, refused, accepted, accepted; no network call on refusal (fake call counter 0) |
| T-PAY-007 | R-PAY-007, 130      | log events and errors containing token, secret, Basic header, transmission signature                                                                    | output contains `[REDACTED]`, never the original strings                                        |
| T-PAY-008 | R-PAY-013, 014, 4.4 | same inputs twice; generation 0 vs 1; amount differs                                                                                                    | equal ids; different ids; length 44; charset base32                                             |
| T-PAY-009 | R-PAY-017, 4.3      | table-driven: each row of 4.3 as a fake response                                                                                                        | `kind` and `outcome` match; unknown 422 issue maps to `rejected` definite                       |
| T-PAY-010 | R-PAY-015           | fake clock/sleep; faults http_500 x2 then ok                                                                                                            | 3 attempts, delays within full-jitter bounds, same request id on all attempts                   |
| T-PAY-011 | R-PAY-015           | http_429 with `Retry-After: 2` and with HTTP date; `Retry-After: 120`                                                                                   | sleep >= 2 s; date parsed; capped at 30 s                                                       |
| T-PAY-012 | R-PAY-016           | slow(15000) with 10 s timeout                                                                                                                           | `network` unknown for POST; transient for GET                                                   |
| T-PAY-013 | R-PAY-010           | 20 concurrent calls with expired token                                                                                                                  | exactly one token request                                                                       |
| T-PAY-014 | R-PAY-010           | http_401_once on capture                                                                                                                                | token refreshed once, call replayed, success; second 401 gives `auth_failed`                    |
| T-PAY-015 | R-PAY-011           | createOrder body inspected at the fake                                                                                                                  | intent AUTHORIZE, one purchase unit, amount value from cents, custom_id = holdId                |
| T-PAY-016 | R-PAY-011           | authorizeOrder on approved and unapproved order                                                                                                         | authId returned; unapproved gives `order_not_approved`                                          |
| T-PAY-017 | R-PAY-012, 051      | capture body at fake                                                                                                                                    | `final_capture: true`, amount decimal, `invoice_id` set                                         |
| T-PAY-018 | R-PAY-018           | fake returns garbage text, HTML 502, empty body                                                                                                         | all surface as `PayPalError`, never SyntaxError                                                 |
| T-PAY-019 | R-PAY-021           | same conformance assertions through `FakeGateway` and `PayPalGateway`+server                                                                            | identical results                                                                               |

### 10.2 Hold lifecycle

| ID        | Requirements   | Case                                                                | Expected                                                      |
| --------- | -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| T-PAY-020 | R-PAY-030      | create, approve via `/__fake/approve`, complete                     | hold HELD with authId stored; browser-supplied authId ignored |
| T-PAY-021 | R-PAY-032      | second `createHoldOrder` while pending / after HELD                 | same orderId / `hold_exists`                                  |
| T-PAY-022 | R-PAY-033      | `completeApproval` twice, plus authorize timeout_after_success once | one authorization at fake, same hold returned                 |
| T-PAY-023 | R-PAY-034      | hold age 2h01m at settlement start                                  | `stale: true` audited, capture still attempted                |
| T-PAY-024 | R-PAY-035, 036 | validate fixtures `contract/fixtures/*.json` against zod            | all parse; mutated examples fail with expected codes          |
| T-PAY-025 | R-PAY-037      | gates-result flag false                                             | `cardEnabled() === false`                                     |
| T-PAY-026 | 8.1            | order approved, no authorize, `recover`                             | authorized when auction open; abandoned when closed           |
| T-PAY-027 | R-PAY-111      | kill switch engaged then createOrder, authorize                     | both refuse with `kill_switch_engaged`, 0 network calls       |

### 10.3 State machine and saga

| ID        | Requirements             | Case                                                                                                                      | Expected                                                                                                                                           |
| --------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-PAY-030 | R-PAY-040, 041           | exhaustive: every (state, event) pair                                                                                     | allowed pairs match 6.1 table, all others throw `IllegalTransition`; `step` pure (deep-equal on repeated call, input not mutated)                  |
| T-PAY-031 | R-PAY-040                | property: random event sequences                                                                                          | the state always in the nine allowed values; terminal states never leave                                                                           |
| T-PAY-032 | R-PAY-044, 045           | second `createSettlement` with different plan; second concurrent `run`                                                    | `plan_mismatch`; `busy`; one set of PayPal effects                                                                                                 |
| T-PAY-033 | R-PAY-050..052, 056, 061 | 3 bidders, ceilings 300/250/200, price 220                                                                                | capture 220 final on winner, voids on others, SETTLED, invariants pass                                                                             |
| T-PAY-034 | R-PAY-052                | price 301 vs ceiling 300; price below reserve; price 0                                                                    | `FAILED_NEEDS_REVIEW` with zero PayPal calls; skip to next candidate; refused                                                                      |
| T-PAY-035 | R-PAY-062                | no candidates, 3 holds                                                                                                    | 3 voids, SETTLED, winner null                                                                                                                      |
| T-PAY-036 | R-PAY-053, 065           | winner capture_declined                                                                                                   | truth check shown in `calls`, FALLBACK_RUNNER_UP, runner-up captured at own price, winner's hold voided in void phase, exactly one capture overall |
| T-PAY-037 | R-PAY-053                | winner hold voided externally; expired by clock (30 d); expired (fake)                                                    | each falls back once                                                                                                                               |
| T-PAY-038 | R-PAY-053                | capture returns 422 but the fake actually applied it (injected inconsistency)                                             | truth shows CAPTURED, adopt, no second capture                                                                                                     |
| T-PAY-039 | R-PAY-054                | persistent timeout_before and timeout_after_success on capture (more than maxAttempts)                                    | state CAPTURING, `pending`, runner-up never called; fake call log has no capture on runner-up                                                      |
| T-PAY-040 | R-PAY-054, 050           | persistent timeouts, then fault cleared, resume                                                                           | truth check first; capture adopted if applied, retried with same request id if not; one capture                                                    |
| T-PAY-041 | R-PAY-055                | unknown outcome beyond deadline (clock advance 601 s)                                                                     | FAILED_NEEDS_REVIEW reason `capture_outcome_unknown`; no voids                                                                                     |
| T-PAY-042 | R-PAY-057, 058           | void for already voided, expired; void http_500 x6; void rejected with live hold                                          | released; released; pending then resume; VOID_FAILED then after 5 resumes FAILED_NEEDS_REVIEW                                                      |
| T-PAY-043 | R-PAY-059                | fake `autoReleaseRemainder` true and false                                                                                | no extra void; explicit void recorded `remainder_voided`; released + captured = hold in both                                                       |
| T-PAY-044 | R-PAY-060                | crash at every label (port of `test_crash_at_every_boundary_then_resume`, parametrized over the label count)              | final journal equals the uninterrupted journal (canonical bytes, ignoring `resumes` and timestamps); invariants pass                               |
| T-PAY-045 | R-PAY-060                | crash everywhere plus `forget_idempotency`                                                                                | same                                                                                                                                               |
| T-PAY-046 | R-PAY-060                | crash everywhere plus timeout_after_success on first capture                                                              | same                                                                                                                                               |
| T-PAY-047 | R-PAY-060                | double crash chain (crash at i, resume, crash at j>i, resume) over all pairs for a 3-bidder plan                          | same                                                                                                                                               |
| T-PAY-048 | R-PAY-063                | engage kill switch before CAPTURING; engage after capture                                                                 | `pending(kill_switch)`, no capture; voids still run; after release resume completes                                                                |
| T-PAY-049 | R-PAY-064, 132           | run with fallback                                                                                                         | audit entries: one per call incl. retries; `settlement_update` sequence matches transitions; canonical JSON key order stable                       |
| T-PAY-050 | R-PAY-150                | run twice with same seed                                                                                                  | journals byte-identical                                                                                                                            |
| T-PAY-051 | R-PAY-071, 072           | hold age 3d 1h, reauth enabled and disabled                                                                               | reauth once with same ceiling when enabled; capture proceeds either way                                                                            |
| T-PAY-052 | R-PAY-061                | property: random plans (2-8 bidders), random single-fault schedules from the 4.5 taxonomy, random crash points, 500 seeds | invariants always hold; terminal state reached after at most 10 resumes or state is `pending` with no capture to a non-winner; at most one capture |
| T-PAY-053 | R-PAY-045                | lease expiry during slow step (advance clock 31 s)                                                                        | second runner can take over; first runner's save fails with `VersionConflict`                                                                      |

### 10.4 Webhooks

| ID        | Requirements   | Case                                                                    | Expected                                                                                  |
| --------- | -------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| T-PAY-060 | R-PAY-090, 093 | valid signature via fake verify; tampered body; missing header          | accept; 401 and audit row; 401                                                            |
| T-PAY-061 | R-PAY-091      | body with unusual whitespace and key order                              | the verify request contains the exact original bytes (assert on the fake's received body) |
| T-PAY-062 | R-PAY-094      | same event id twice and 50 times concurrently                           | one insert, one effect, all 200                                                           |
| T-PAY-063 | R-PAY-095      | event claims capture of 999 but truth says 220                          | ledger uses 220; `AMOUNT_MISMATCH` finding                                                |
| T-PAY-064 | R-PAY-096      | deliver full event set in `reverse`, `shuffle(seed 1..20)`, `duplicate` | final hold statuses equal the fifo result in every mode                                   |
| T-PAY-065 | R-PAY-096      | CAPTURE.COMPLETED before settlement record; unknown hold                | observed_captured then adopted; parked then resolved by `sweepOrphans`                    |
| T-PAY-066 | R-PAY-097      | CAPTURED then VOIDED for same hold                                      | not applied, `status_conflict` audit                                                      |
| T-PAY-067 | R-PAY-098      | unknown event type; fixtures from G4 (when present)                     | 200 and stored; fixture parse tests                                                       |
| T-PAY-068 | R-PAY-099      | store latency 100 ms, truth-check latency 3 s                           | handler returns 200 under 300 ms with event stored                                        |
| T-PAY-069 | R-PAY-126      | `drop` 100% of webhooks through a full saga                             | settlement still SETTLED; reconcile reports no drift (polling covers)                     |

### 10.5 Reconciliation, safety, gates

| ID        | Requirements        | Case                                                                                    | Expected                                                                 |
| --------- | ------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| T-PAY-070 | R-PAY-007, 141      | evidence lint over sample records, including one with a planted token                   | planted record rejected; clean ones pass; schema validation of the jsonl |
| T-PAY-071 | R-PAY-100, 103      | seeded drift per finding code (6 fixtures)                                              | each code reported once; two runs equal besides `observedAt`             |
| T-PAY-072 | R-PAY-101           | live hold after SETTLED; repair off and on                                              | reported; voided only with `repair`; no capture ever                     |
| T-PAY-073 | R-PAY-110, 112, 113 | engage, restart (new instance on same store), void all                                  | still engaged; voids audited with actor                                  |
| T-PAY-074 | R-PAY-120, 121, 125 | server boots on ephemeral port, call each route, reset                                  | responses match recorded fixture shapes; ids deterministic               |
| T-PAY-075 | R-PAY-122           | every fault kind in 4.5 applied once to capture                                         | observed client behaviour matches the 4.5 table                          |
| T-PAY-076 | R-PAY-123           | same request id different params                                                        | 422 mapped `idempotency_conflict`                                        |
| T-PAY-077 | R-PAY-124           | clock advance across honor and validity boundaries with both `afterHonorCapture` values | statuses and errors per prototype tests `test_fake_paypal.py` (ported)   |
| T-PAY-078 | R-PAY-127           | corrupt the fake state (double final capture)                                           | `assertFakeInvariants` throws                                            |
| T-PAY-079 | R-PAY-140..143      | `npm run gate:g1 -- --fake` for both remainder modes                                    | evidence file valid, decision A or B printed according to the mode       |
| T-PAY-080 | R-PAY-147           | `npm run measure -- --fake`                                                             | output JSON validates; p50 <= p95 <= p99                                 |
| T-PAY-081 | R-PAY-128           | conformance suite on fake; (manual) on sandbox                                          | same assertions pass; differences logged                                 |

### 10.6 Sandbox-only (manual workflow, secrets present)

| ID        | Requirements  | Case                                                                      | Expected                                       |
| --------- | ------------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| T-PAY-090 | G1, R-PAY-143 | evidence per 7.1 for wallet and card buyers                               | GATES.md entry with decision                   |
| T-PAY-091 | G2, R-PAY-144 | SDK v6 page, AUTHORIZE, wallet and guest card                             | order id and authorization id in evidence      |
| T-PAY-092 | G3, R-PAY-145 | immediate reauth plus day 3.5, 4, 5 probe                                 | documented behaviour                           |
| T-PAY-093 | G4, R-PAY-146 | real capture and void produce events that verify                          | fixtures committed                             |
| T-PAY-094 | R-PAY-060     | kill the process between capture and journal save on the sandbox (PAY-67) | one capture on PayPal, reconcile clean         |
| T-PAY-095 | R-PAY-013     | repeat a capture with the same request id and with a different id         | observed behaviour recorded; spec tags flipped |

## 11. Open questions

| #   | Question                                                                                       | Decision owner                  | Default until decided                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Does `final_capture=true` auto-release the remainder (G1), and is it the same for card buyers? | payments (P1), evidence from G1 | Assume not: explicit void branch on (R-PAY-059)                                                                                        |
| Q2  | Who writes the SQL adapters for `JournalStore`, `WebhookEventStore`, `HoldStore`?              | realtime, with payments review  | payments ships in-memory and JSON-file stores; realtime implements SQL from the interfaces and runs the shared contract tests (PAY-26) |
| Q3  | Runner-up price: own best bid (prototype) vs next price level in second-price mode             | engine                          | prototype behaviour; payments takes the price from the plan                                                                            |
| Q4  | Can the card-funded guest flow run with intent AUTHORIZE in SDK v6 (G2)?                       | payments (P1) with web          | wallet buyers only                                                                                                                     |
| Q5  | Public webhook URL for G4 and the demo (hosted server, or temporary tunnel)                    | infra with Project owner        | polling reconciliation only; webhook ticks from our own truth checks                                                                   |
| Q6  | Is a hard 2-hour hold age appropriate for demos spanning more than one session?                | Project owner                   | 2 h default; override by env                                                                                                           |
| Q7  | Who runs the day-4/5 G3 probe, and with which sandbox accounts, given the deadline of Nov 12?  | Project owner                   | probe started on Nov 4 so day 5 lands on Nov 9                                                                                         |
