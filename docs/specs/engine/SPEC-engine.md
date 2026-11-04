# SPEC-engine: deterministic auction engine, ledger and audit trail

Area: ENG. Package: `packages/engine` (`@gavel/engine`). Status: draft for implementation, 2026-11-04.
Related: `docs/PLAN.md`, `reference/python/engine.py` (prototype), branch `feat/engine-ts` (first TypeScript port).

## 1. Purpose and scope

GAVEL turns every bid in a live auction into a promise backed by a PayPal authorization hold. The engine is the part that decides, with no ambiguity and no I/O, what each bid means: accepted or rejected and why, who leads, what the price is, when the lot closes, who wins, what they pay, and who is next in line if the winner's hold fails. Every decision is recorded in an append-only, hash-chained ledger, so the whole auction can be replayed and proven after the fact.

In scope:

- Auction modes `english`, `proxy`, `second_price`; reserve; flat and laddered increments; soft close with caps; per-bidder ceilings (the hold amount); runner-up ranking and fallback pricing; multi-lot events with cumulative exposure.
- Command model (`decide`), event model (`evolve`), ledger sealing and verification, bid audit record, replay and state digest.
- A thin single-writer runtime over a `LedgerStore` interface (no database code), projections that are safe to send to viewers, a clock abstraction.
- Golden fixtures shared with the Python reference, property tests, differential tests, fault injection.

Out of scope (owned elsewhere):

- PayPal calls, the capture/void saga and its transition graph (payments). The engine only records settlement facts it is told.
- WebSocket transport, auth, persistence adapters, rate limiting (realtime). Wire message schemas and error-code registry (shared).
- Speech-to-text and bid parsing (voice). The engine receives the parsed amount plus the audit fields and enforces the confirmation rule as a last safety net.
- UI (web).

Gates: nothing in this spec depends on an unverified PayPal behaviour. Two design choices are conditional and marked `UNVERIFIED (G1)`: (a) whether several partial captures can be taken from one authorization (decides holdScope `event` versus `lot`, section 9 Q1); (b) whether the ledger head hash can be carried in a capture field such as an invoice or note (nice to have, section 9 Q5). Fallback for both is stated where they appear.

## 2. Definitions

- Cents: integer minor units of USD. Money never uses floating point.
- `at`: server time, integer epoch ms, supplied by the host with each command. The engine has no clock.
- Lot: one item sold in one mode. Auction (event): ordered set of lots sharing bidders.
- Ceiling: the amount a bidder's hold authorizes; no bid or sum of wins may exceed it.
- Committed: hammer prices of lots a bidder currently holds as winner (within the ceiling's scope).
- Available: ceiling minus committed.
- Active bid: an accepted bid that has not been struck.
- Ranking: bidders ordered by best active bid (amount desc, `at` asc, `seq` asc).
- Candidate: a bidder eligible to win with the price they would pay.
- Ledger entry: sealed record `{v,auctionId,seq,at,type,cmd,payload,prev,hash}`.
- Command: an instruction to the engine (PlaceBid, Hammer ...). Event: a payload appended to the ledger as a consequence.
- Single writer: exactly one runtime instance serialises commands for an auction.
- Golden fixture: a JSON scenario with expected results, run by both TypeScript and Python.

## 3. Requirements

Requirement ids are stable; the test and issue tables refer to them.

### Money, time, identifiers

- **R-ENG-001** All money values MUST be safe integers in cents, between 1 and MAX_AMOUNT_CENTS (100_000_000). A bid amount that is non-integer, NaN, zero, negative or above the maximum MUST be rejected with reason `bad_amount` and MUST NOT appear as a number in any hashed payload (see aud-raw).
- **R-ENG-002** The only currency is `USD`. A config with any other currency MUST fail validation with code `unsupported_currency`.
- **R-ENG-003** All times MUST be integer epoch milliseconds passed in by the caller as `at`. Engine code MUST NOT read the system clock, `Date`, or any random source.
- **R-ENG-004** A command whose `at` is lower than the ledger head `at` MUST throw `EngineError('time_regression')` and append nothing. The package MUST export `monotonicAt(now, headAt)` returning `max(now, headAt)` for callers that choose to clamp.
- **R-ENG-005** `commandId`, `lotId`, `auctionId` and `bidderId` MUST match `^[0-9A-HJKMNP-TV-Z]{26}$`; anything else MUST fail with `bad_id` before any state is read.
- **R-ENG-006** No payload key may equal `__proto__`, `constructor` or `prototype`; internal maps keyed by caller-supplied ids MUST be `Map` instances or null-prototype objects.
- **R-ENG-007** Limits MUST be enforced: transcript <= 2000 chars, title <= 120, lots per auction <= 200, bidders per auction <= 1000, accepted bids per lot <= 20000, holdRef <= 128 chars. Violations fail with `limit_exceeded`.

### Configuration

- **R-ENG-008** `validateAuctionConfig` and `validateLotConfig` MUST return `{ok:true,value}` or `{ok:false,errors:[{path,code,message}]}` and MUST NOT throw on bad input; all errors are reported, not only the first.
- **R-ENG-009** Defaults MUST be: holdScope `event`, confirmBelowBps 8500, fallbackPolicy `runner_up`, maxFallbackDepth 2, hammer `auto`, increment flat 100 cents, softClose window 0 (disabled), maxExtensions 10.
- **R-ENG-010** Reserve MUST be >= 1 cent. Increment is either `{flatCents>=1}` or `{ladder:[{fromCents,incrementCents}]}` where the first `fromCents` is 0, `fromCents` strictly increases and every `incrementCents` >= 1.
- **R-ENG-011** A `second_price` lot MUST have soft close disabled (windowMs 0); otherwise validation fails with `soft_close_not_allowed_sealed`.
- **R-ENG-012** windowMs and extensionMs MUST be within 0..600000, maxExtensions within 0..50, durationMs within 1000..86400000, and if `hardCloseMs` is set it MUST be >= durationMs.
- **R-ENG-013** `holdScope` is `event` (one ceiling shared by all lots) or `lot` (a ceiling per lot). `RegisterBidder` MUST carry `lotId` if and only if holdScope is `lot`.
- **R-ENG-014** The package MUST export `CEILING_PRESETS_CENTS = [10000,25000,50000,100000]`, `MIN_CEILING_CENTS = 100`, and a `maxCeilingCents` config value (default 100000, sandbox demo cap) that registration enforces.
- **R-ENG-015** A lot's configuration MUST NOT change once the lot has been opened; any attempt fails with `lot_frozen`.

### Auction modes and pricing

- **R-ENG-016** English mode: the first accepted bid MUST be >= reserve; every later bid MUST be >= currentPrice + increment(currentPrice).
- **R-ENG-017** English mode: the current price is the highest active bid and the winner pays exactly the winning bid.
- **R-ENG-018** English mode: the current leader MUST NOT outbid themselves; the bid is rejected with `already_leading`.
- **R-ENG-019** Proxy mode: bids are maximums. With one bidder the price is reserve; with two or more it is `max(reserve, min(top, second + increment(second)))`.
- **R-ENG-020** Proxy mode: a bidder MAY raise their own maximum; a bid <= their best active maximum is rejected with `not_higher_than_own_max`.
- **R-ENG-021** Proxy mode: equal maximums are won by the earlier `(at, seq)`; the price then equals that maximum.
- **R-ENG-022** Second-price mode: one bid per bidder; a second bid is rejected with `already_bid`.
- **R-ENG-023** Second-price mode: the hammer price is `max(reserve, secondHighest)`; with a single bidder it is reserve. The public price before the hammer MUST be null.
- **R-ENG-024** Ranking uses each bidder's best active bid and sorts by amount descending, then `at` ascending, then `seq` ascending. The order MUST be total and independent of insertion order for distinct `(at,seq)`.
- **R-ENG-025** With a ladder, `increment(p)` is the `incrementCents` of the entry with the greatest `fromCents <= p`.
- **R-ENG-026** For every hammered lot, `price <= winner's available ceiling` MUST hold; if it would not, the engine MUST throw `InvariantError` and append nothing.

### Bid validation

- **R-ENG-027** PlaceBid checks MUST run in this order and report the first failure: lot_not_open, unregistered, ceiling_revoked, bad_amount, unconfirmed, over_ceiling, below_reserve, then mode rules (below_increment, already_leading, not_higher_than_own_max, already_bid).
- **R-ENG-028** The reject reasons MUST be exported as the const array `REJECT_REASONS` and be the only values that appear in `BID_REJECTED.reason`.
- **R-ENG-029** A bidder never registered MUST be rejected `unregistered`; a bidder whose ceiling was revoked MUST be rejected `ceiling_revoked`.
- **R-ENG-030** A voice bid with `confidenceBps < confirmBelowBps` and `confirmed !== true` MUST be rejected `unconfirmed`. Manual and QR bids are exempt.
- **R-ENG-031** A rejected bid MUST append exactly one `BID_REJECTED` entry and change no lot state (except an implicit closing, see val-implicit-close).
- **R-ENG-032** Accepted bids are binding: no command withdraws or edits a bid. Only `BID_STRUCK` (ceiling revocation) removes a bid from ranking, and the bid stays in the ledger.
- **R-ENG-033** A PlaceBid with `at >= endsAt` on an OPEN lot MUST append `LOT_CLOSING` (reason `deadline`) and then `BID_REJECTED(lot_not_open)` in one atomic batch.

### Soft close

- **R-ENG-034** An accepted bid with `at >= endsAt - windowMs` MUST set `endsAt = max(endsAt, at + extensionMs)` and increment `extensions`, if soft close is enabled and extensions < maxExtensions.
- **R-ENG-035** Exact boundaries: `at == endsAt - windowMs` triggers; `at == endsAt - windowMs - 1` does not; `at == endsAt - 1` is accepted; `at == endsAt` is rejected as lot_not_open.
- **R-ENG-036** `endsAt` MUST never exceed `openedAt + hardCloseMs` when hardCloseMs is set, and extensions MUST never exceed maxExtensions.
- **R-ENG-037** Second-price lots never extend.
- **R-ENG-038** Each extension MUST append `END_EXTENDED{lotId,endsAtBefore,endsAtAfter,extensions,triggerBidId}` immediately after the triggering `BID_RECORDED`.
- **R-ENG-039** Rejected bids MUST NOT extend the end time.

### Ceilings and exposure

- **R-ENG-040** `RegisterBidder{bidderId,ceilingCents,holdRef?,lotId?}` creates a ceiling within `[MIN_CEILING_CENTS, maxCeilingCents]` and appends `BIDDER_REGISTERED`; out-of-range fails `bad_ceiling`.
- **R-ENG-041** Registering an existing bidder again MAY only raise the ceiling (`CEILING_RAISED`); a lower or equal value fails `cannot_lower_ceiling`.
- **R-ENG-042** A bid with amount > availableCeiling MUST be rejected `over_ceiling`, where availableCeiling = ceiling - committed(bidder).
- **R-ENG-043** `committed(bidder)` is the sum of hammer prices of lots the bidder currently holds as winner (status SETTLING or DONE, not failed or demoted) within the same holdScope key.
- **R-ENG-044** `RevokeCeiling{bidderId,reason}` appends `CEILING_REVOKED`; further bids are rejected; if the lot is OPEN or CLOSING each of the bidder's active bids gets a `BID_STRUCK` entry and the ranking is recomputed. After a hammer, the engine only records the revocation (fallback is a separate command).
- **R-ENG-045** Ceilings and holdRefs MUST NOT appear in the public or other-bidder projections, only in the auditor projection and the bidder's own view.
- **R-ENG-046** `holdRef` is an opaque string stored for audit; the engine never interprets it.

### Hammer and outcome

- **R-ENG-047** `Hammer` is valid only when the lot is CLOSING, or OPEN with `early:true`; otherwise it fails `cannot_hammer`.
- **R-ENG-048** `LOT_HAMMERED` payload MUST contain `lotId, winnerId, priceCents, mode, ranking[{bidderId,amountCents,at,seq}], candidates[{bidderId,priceCents}], endsAt, extensions, closedAtSeq`.
- **R-ENG-049** A hammer with no active bids appends `LOT_UNSOLD{lotId,reason:'no_bids'}` and ends the lot as DONE.
- **R-ENG-050** Hammer price follows the mode rules: english top bid; proxy `price()`; second_price `max(reserve, second)`.
- **R-ENG-051** `candidates` lists the winner first and up to `maxFallbackDepth` runner-ups, each with the price they would pay if every earlier candidate were disqualified.
- **R-ENG-052** An early hammer appends `LOT_CLOSING` with reason `early` before `LOT_HAMMERED`, and is recorded with the caller's `actor` string.
- **R-ENG-053** `nextDeadline(state)` returns the active lot's `endsAt` when OPEN, else null, so the host can schedule a `Tick`; `Tick{at}` with `at >= endsAt` appends `LOT_CLOSING` (reason `deadline`), otherwise appends nothing.

### Runner-up fallback

- **R-ENG-054** `PromoteRunnerUp{lotId,disqualifiedBidderId,reason}` is valid for a SETTLING lot and the current winner only; it appends `FALLBACK_PROMOTED{lotId,from,to,priceCents,depth,reason}` naming the next candidate.
- **R-ENG-055** The promoted price is recomputed by re-running the mode's pricing over active bids with all disqualified bidders removed (english: own bid; proxy and second_price: the recomputed formulas).
- **R-ENG-056** A candidate whose price exceeds their current available ceiling, or whose ceiling is revoked, MUST be skipped with `CANDIDATE_SKIPPED{bidderId,reason}` and the next candidate considered in the same batch.
- **R-ENG-057** When candidates run out or depth exceeds `maxFallbackDepth`, the engine appends `LOT_UNSOLD{reason:'no_valid_winner'}`.
- **R-ENG-058** A demoted winner's committed amount is released at the moment of demotion; the promoted bidder's committed amount increases by the new price.
- **R-ENG-059** Every fallback step (promotion, skip, unsold) MUST be a ledger entry carrying the reason string, depth and the price, so the settlement history can be reconstructed from the ledger alone.
- **R-ENG-060** With `fallbackPolicy:'unsold'`, PromoteRunnerUp appends `LOT_UNSOLD{reason:'no_valid_winner'}` directly.

### Multi-lot events

- **R-ENG-061** At most one lot is OPEN or CLOSING at a time; `OpenLot` is valid only if the previous lot in order is SETTLING, DONE or the lot is first.
- **R-ENG-062** Lots open in `lotOrder` as added; `OpenLot{lotId}` for a non-next PENDING lot fails `out_of_order`.
- **R-ENG-063** With holdScope `event`, a winner's hammer price on lot N reduces their available ceiling on every later lot.
- **R-ENG-064** `CloseAuction` is valid only when all lots are DONE (settled or unsold) and appends `AUCTION_CLOSED{headHash anchor}`; afterwards every command fails `auction_closed`.
- **R-ENG-065** Bids on one lot never alter the ranking, price or end time of another lot.

### Settlement entries

- **R-ENG-066** `CompleteLot{lotId,capturedCents,ref}` appends `LOT_SETTLED`; `capturedCents` MUST equal the hammer or promoted price, else the command fails `capture_mismatch` and appends nothing.
- **R-ENG-067** `RecordSettlement{lotId,from,to,ref}` appends `SETTLEMENT_STATE`; `to` MUST be a member of the fixed settlement states and `from` MUST equal the lot's last recorded state (initial HELD). The transition graph itself is owned by the payments package.
- **R-ENG-068** A DONE lot accepts no further bid, hammer, promote or settlement command (`lot_done`).
- **R-ENG-069** Sum of captured cents per bidder per holdScope key MUST NOT exceed that bidder's ceiling; the engine MUST throw `InvariantError` instead of recording a violating `LOT_SETTLED`.

### Ledger and hash chain

- **R-ENG-070** A ledger entry is `{v:1,auctionId,seq,at,type,cmd,payload,prev,hash}`; `cmd` is the commandId or null.
- **R-ENG-071** Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, integers only (no floats, no -0, no exponent), strings escaped as `JSON.stringify`, `undefined` and lone surrogates rejected with `non_canonical`.
- **R-ENG-072** `hash = lowercase hex SHA-256 of UTF-8 canonical JSON of the entry without its `hash` field`; the genesis `prev` is 64 zeros. The golden vector in this spec MUST be reproduced by TypeScript and Python.
- **R-ENG-073** `seq` starts at 1 and increases by exactly 1; `at` is non-decreasing.
- **R-ENG-074** `verifyChain(entries, {expectedHead?})` returns `{ok, count, headHash}` or `{ok:false, firstBadIndex, reason}` and MUST detect: field mutation, reorder, deleted middle entry, duplicated entry, wrong prev, wrong hash, wrong seq, and (with expectedHead) tail truncation.
- **R-ENG-075** The head hash and seq MUST be exposed via `headOf(entries)` so the host can show it on receipts and compare it to a previously published value.
- **R-ENG-076** One command appends a batch of 1..k entries atomically with the same `at`; stores MUST persist all or none.
- **R-ENG-077** Entries are deeply frozen after sealing; the public API has no function that updates or deletes an entry.
- **R-ENG-078** Ledgers export as JSON Lines (one entry per line, canonical JSON). `verifyJsonl(text)` and the CLI `verify-ledger` verify an export without any server.
- **R-ENG-079** SHA-256 MUST be implemented in pure TypeScript behind a `Hasher` interface, pass the NIST short-message vectors, and need no Node built-ins, so a browser can verify a ledger.
- **R-ENG-080** An entry with `v` other than 1 MUST fail verification with `unsupported_version`.

### Bid audit record

- **R-ENG-081** `BID_RECORDED` payload MUST contain `bidId, lotId, bidderId, amountCents, source, audit, priceBefore, priceAfter, leaderBefore, leaderAfter, rank, endsAtBefore, endsAtAfter`.
- **R-ENG-082** `BID_REJECTED` stores the submitted amount as `amountCents` when it is a safe integer, else `amountCents:null` and `amountRaw` as a string (max 40 chars).
- **R-ENG-083** `audit` carries `{utteranceId?, audioStartMs?, audioEndMs?, transcript?, confidenceBps?, confirmed?, parserVersion?, clientTs?}`; `confidenceBps` is an integer 0..10000.
- **R-ENG-084** `source` is one of `voice`, `manual`, `qr`; any other value fails validation.
- **R-ENG-085** `clientTs` is advisory and MUST NOT influence ordering, tie-breaks or soft close; only the server `at` and `seq` do.
- **R-ENG-086** In sealed mode the ledger keeps real amounts; `priceAfter` is null while OPEN. Public projections hide amounts until the hammer.

### Commands and idempotency

- **R-ENG-087** Re-dispatching a command with an already-seen `commandId` and identical body MUST return the original result and append nothing.
- **R-ENG-088** The same `commandId` with a different body MUST fail `command_conflict` and append nothing.
- **R-ENG-089** Unknown command types or unknown fields MUST be rejected `bad_command`.
- **R-ENG-090** `decide(state, cmd)` MUST be a pure function: it never mutates `state` or `cmd`, and equal inputs give deep-equal outputs.
- **R-ENG-091** `decide` returns `{events, outcome}` where outcome is `accepted | rejected{reason} | noop | duplicate`; commands that fail precondition checks other than bid validation throw `EngineError{code}` and append nothing.

### Replay and determinism

- **R-ENG-092** State MUST equal `entries.reduce(evolve, initial)`; `evolve` is the only way state changes.
- **R-ENG-093** `stateDigest(state)` (SHA-256 of canonical state projection) MUST be equal for live and replayed state at every prefix of any ledger.
- **R-ENG-094** `replay(entries)` verifies the chain first and fails closed with `ChainError` before building state.
- **R-ENG-095** `evolve` MUST not throw for any entry produced by `decide`; an entry of unknown type throws `unknown_entry_type`.
- **R-ENG-096** Adding a constant to every `at` (and lot durations unchanged) yields the same outcomes, ranking and prices.
- **R-ENG-097** In second_price mode with distinct `at`, the outcome is invariant under permutation of bid arrival order.

### Runtime and store

- **R-ENG-098** `AuctionRuntime.dispatch` MUST serialise commands per auction (single writer) in FIFO order.
- **R-ENG-099** The runtime hydrates state from the store by verified replay on first use and caches it; a restart reproduces identical state.
- **R-ENG-100** A command result MUST be returned and observers notified only after the store acknowledged the append.
- **R-ENG-101** On `LedgerConflict` the runtime MUST rehydrate and retry the command at most 3 times, then surface `store_conflict`.
- **R-ENG-102** When `append` fails with an unknown outcome the runtime MUST read the head and look for the commandId before retrying, so an entry is never written twice.
- **R-ENG-103** `subscribe(auctionId, fromSeq)` yields every entry with seq >= fromSeq in order, then live entries, with no gaps or duplicates.
- **R-ENG-104** `LedgerStore` is an interface (`append`, `read`, `head`) with an `InMemoryLedgerStore`, and a reusable contract-test kit that other adapters run; `append` takes `expectedHeadSeq` and fails with `LedgerConflict` on mismatch.
- **R-ENG-105** The runtime MUST call an optional `onDecision({commandType, outcome, reason?, durationMs, entries})` hook; hook failures MUST NOT affect dispatch.

### Projections and privacy

- **R-ENG-106** `projectPublic(state)` exposes lot title, status, endsAt, current price, leader alias and bid count, never ceilings, holdRefs, or other bidders' maximums.
- **R-ENG-107** `projectBidder(state, bidderId)` adds the bidder's own ceiling, committed and available amounts, and own bids.
- **R-ENG-108** `projectAuditor(entries)` returns the full ledger with sealed amounts shown only after the hammer of that lot unless `{full:true}` is passed by an authorised caller.
- **R-ENG-109** While a sealed lot is OPEN, public output MUST contain no amount derived from any bid; a scan of the JSON for every submitted amount finds none.
- **R-ENG-110** Bidder display names are held outside the ledger; projections use the alias supplied via `aliasOf(bidderId)`.

### Golden fixtures and parity

- **R-ENG-111** Golden fixtures are JSON files under `packages/engine/fixtures/golden/` validated by a schema (`name, parity, config, steps, expect`) and shared byte for byte with the Python reference.
- **R-ENG-112** Every fixture flagged `parity:true` MUST produce identical rankings, prices, winner and reject reasons in the TypeScript engine and the Python reference.
- **R-ENG-113** `reference/python/golden_runner.py` MUST run all parity fixtures against `engine.py`, converting integer ms to seconds, and fail on any difference.
- **R-ENG-114** A seeded differential job (Python scenario exporter, TypeScript consumer) MUST compare at least 2000 random scenarios per CI run.
- **R-ENG-115** A scripted demo fixture (`demo-gala.json`) with three lots, one soft-close extension, one ceiling rejection, one unconfirmed voice bid, one runner-up fallback MUST replay to a fixed head hash.
- **R-ENG-116** The legacy `Auction` class API (register, placeBid, hammer, complete) MUST keep passing the existing test file by running on the new core.

### Non-functional

- **R-ENG-117** On Node 22, decide+seal+evolve for a lot with 200 bidders and 5000 bids MUST have p99 < 5 ms and median < 1 ms.
- **R-ENG-118** Verified replay of 10000 entries MUST complete in < 500 ms.
- **R-ENG-119** `@gavel/engine` MUST have zero runtime dependencies.
- **R-ENG-120** The core entry point MUST import no Node built-ins and bundle for browsers and edge runtimes; Node-only helpers live in `@gavel/engine/node`.
- **R-ENG-121** A lint rule MUST ban `Date.now`, `new Date`, `Math.random`, `crypto.randomUUID` and `performance.now` in `src/` outside `clock.ts` and `runtime.ts`.
- **R-ENG-122** CI MUST enforce >= 95% line and >= 90% branch coverage for `packages/engine/src`.
- **R-ENG-123** The engine workflow MUST run typecheck, lint, unit, property and fixture tests on every PR, upload coverage, and run the Python golden runner.
- **R-ENG-124** A script MUST fail CI if any `R-ENG-` id is not referenced by a test title or any test title lacks a `T-ENG-` id.
- **R-ENG-125** `src/index.ts` is the single public surface; exported names are listed in `api.snapshot.txt` and a change requires updating the snapshot.
- **R-ENG-126** Package README documents the command list, ledger format, hash vector, fixture format and how to add a fixture.

## 4. Interfaces

### 4.1 Package layout (single owner: engine)

```
packages/engine/
  src/types.ts reasons.ts errors.ts canonical.ts sha256.ts hasher.ts clock.ts policy.ts config.ts
  src/commands.ts events.ts state.ts evolve.ts replay.ts projections.ts runtime*.ts legacy.ts index.ts
  src/rules/ranking.ts pricing-basic.ts pricing-proxy.ts increment.ts softclose.ts exposure.ts
             validate-bid.ts candidates.ts
  src/decide/index.ts setup.ts open-lot.ts place-bid.ts hammer.ts promote.ts revoke.ts settlement.ts close-auction.ts
  src/ledger/chain.ts store.ts memory-store.ts export.ts
  src/testing/fixtures.ts store-contract.ts faulty-store.ts replay-driver.ts
  src/node/index.ts            (Node-only helpers, optional crypto hasher)
  bin/verify-ledger.mjs
  fixtures/golden/*.json  README.md  SCHEMA.json
  test/ ... (unit, properties/, fault/, fuzz/, contract/, scenario/)
reference/python/golden_runner.py scenario_export.py test_golden.py   (owned by engine)
```

The existing `src/engine.ts` stays until `legacy.ts` replaces its internals; its test file is not edited.

### 4.2 Core types

```ts
export type Cents = number; // safe integer, 1..100_000_000 for bids
export type EpochMs = number; // integer
export type Ulid = string;
export type Mode = 'english' | 'proxy' | 'second_price';
export type LotStatus = 'PENDING' | 'OPEN' | 'CLOSING' | 'SETTLING' | 'DONE';
export type BidSource = 'voice' | 'manual' | 'qr';

export type IncrementRule =
  | { flatCents: number }
  | { ladder: Array<{ fromCents: number; incrementCents: number }> };

export interface SoftClose {
  windowMs: number;
  extensionMs: number;
  maxExtensions: number;
  hardCloseMs?: number;
}

export interface AuctionConfig {
  currency: 'USD';
  holdScope: 'event' | 'lot';
  maxCeilingCents: number; // default 100000 in sandbox
  confirmBelowBps: number; // default 8500
  fallbackPolicy: 'runner_up' | 'unsold';
  maxFallbackDepth: number; // default 2
}
export interface LotConfig {
  lotId: Ulid;
  title: string;
  mode: Mode;
  reserveCents: number;
  increment: IncrementRule;
  durationMs: number;
  softClose: SoftClose;
  hammer: 'auto' | 'manual';
}
export interface BidAudit {
  utteranceId?: string;
  audioStartMs?: number;
  audioEndMs?: number;
  transcript?: string;
  confidenceBps?: number;
  confirmed?: boolean;
  parserVersion?: string;
  clientTs?: number;
}
```

### 4.3 Commands (all carry `commandId: Ulid`, `at: EpochMs`, `auctionId`)

```ts
type Command =
  | { type: 'CreateAuction'; title: string; config: Partial<AuctionConfig> }
  | { type: 'AddLot'; lot: LotConfig }
  | { type: 'RegisterBidder'; bidderId: Ulid; ceilingCents: number; holdRef?: string; lotId?: Ulid }
  | { type: 'OpenLot'; lotId: Ulid }
  | {
      type: 'PlaceBid';
      lotId: Ulid;
      bidderId: Ulid;
      amountCents: number;
      source: BidSource;
      audit: BidAudit;
    }
  | { type: 'Tick' }
  | { type: 'Hammer'; lotId: Ulid; early?: boolean; actor: string }
  | { type: 'RevokeCeiling'; bidderId: Ulid; reason: 'declined' | 'expired' | 'voided' | 'other' }
  | { type: 'PromoteRunnerUp'; lotId: Ulid; disqualifiedBidderId: Ulid; reason: string }
  | { type: 'CompleteLot'; lotId: Ulid; capturedCents: number; ref: string }
  | {
      type: 'RecordSettlement';
      lotId: Ulid;
      from: SettlementState;
      to: SettlementState;
      ref: string;
    }
  | { type: 'CloseAuction' };
```

`SettlementState` is the fixed list: HELD, BIDDING, WINNER_SELECTED, CAPTURING, CAPTURED, VOIDING, SETTLED, FALLBACK_RUNNER_UP, FAILED_NEEDS_REVIEW.

### 4.4 Decision, evolution, runtime

```ts
export type Outcome =
  | { kind: 'accepted' }
  | { kind: 'rejected'; reason: RejectReason }
  | { kind: 'noop' }
  | { kind: 'duplicate' };
export interface DecideResult {
  events: LedgerEvent[];
  outcome: Outcome;
}

export function decide(state: AuctionState, cmd: Command): DecideResult; // pure
export function evolve(state: AuctionState, entry: LedgerEntry): AuctionState; // pure, total
export function replay(entries: readonly LedgerEntry[], hasher?: Hasher): AuctionState;
export function stateDigest(state: AuctionState, hasher?: Hasher): string;
export function nextDeadline(state: AuctionState): EpochMs | null;
export function monotonicAt(now: number, headAt: number): number;

export interface LedgerStore {
  append(auctionId: Ulid, entries: LedgerEntry[], expectedHeadSeq: number): Promise<void>; // atomic; LedgerConflict
  read(auctionId: Ulid, fromSeq: number): Promise<LedgerEntry[]>;
  head(auctionId: Ulid): Promise<{ seq: number; hash: string } | null>;
}
export class AuctionRuntime {
  constructor(opts: {
    store: LedgerStore;
    hasher?: Hasher;
    onDecision?: (m: DecisionMetric) => void;
  });
  dispatch(cmd: Command): Promise<DecideResult & { entries: LedgerEntry[] }>;
  subscribe(auctionId: Ulid, fromSeq: number): AsyncIterable<LedgerEntry>;
  state(auctionId: Ulid): Promise<AuctionState>;
}
export function projectPublic(s: AuctionState, aliasOf: (id: Ulid) => string): PublicView;
export function projectBidder(
  s: AuctionState,
  bidderId: Ulid,
  aliasOf: (id: Ulid) => string,
): BidderView;
export function projectAuditor(
  entries: readonly LedgerEntry[],
  opts?: { full?: boolean },
): LedgerEntry[];
export function verifyChain(
  entries: readonly LedgerEntry[],
  o?: { expectedHead?: { seq: number; hash: string } },
): VerifyResult;
```

`VerifyResult = {ok:true,count,headHash} | {ok:false,firstBadIndex,reason:'bad_hash'|'bad_prev'|'bad_seq'|'bad_time'|'unsupported_version'|'truncated'}`.

### 4.5 Ledger entry, canonical form and golden vector

Event types (18): AUCTION_CREATED, LOT_ADDED, BIDDER_REGISTERED, CEILING_RAISED, CEILING_REVOKED, LOT_OPENED, BID_RECORDED, BID_REJECTED, BID_STRUCK, END_EXTENDED, LOT_CLOSING, LOT_HAMMERED, FALLBACK_PROMOTED, CANDIDATE_SKIPPED, LOT_UNSOLD, SETTLEMENT_STATE, LOT_SETTLED, AUCTION_CLOSED.

Hash input is the canonical JSON (keys sorted, no spaces, integers only) of the entry without `hash`. Golden vector (Python `hashlib.sha256` over `json.dumps(sort_keys=True, separators=(',',':'))`; must match TypeScript):

```
entry 1 canonical:
{"at":1788000000000,"auctionId":"01JC0000000000000000000001","cmd":"01JC0000000000000000000A01","payload":{"config":{"currency":"USD","holdScope":"event"},"title":"Spring Gala"},"prev":"0000000000000000000000000000000000000000000000000000000000000000","seq":1,"type":"AUCTION_CREATED","v":1}
hash 1 = e1d36276c41c5b7d87c45b87dd29d4d1432dcdadced3035f1a8dfc0486045540
entry 2 canonical:
{"at":1788000001000,"auctionId":"01JC0000000000000000000001","cmd":"01JC0000000000000000000A02","payload":{"lotId":"01JC0000000000000000000L01"},"prev":"e1d36276c41c5b7d87c45b87dd29d4d1432dcdadced3035f1a8dfc0486045540","seq":2,"type":"LOT_ADDED","v":1}
hash 2 = f685ed77a83bf8dde536e1f3ffc999879451cb2c1052c15d9ccd4b30929a5b13
SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

(The vector uses illustrative ids; the lot id in entry 2 is not a valid ULID letter set for engine validation, so the vector test calls `sealBatch` directly, which does not validate ids.)

### 4.6 Example accepted-bid entry (payload fields per aud-fields)

```json
{
  "v": 1,
  "auctionId": "01JC0000000000000000000001",
  "seq": 14,
  "at": 1788000123456,
  "type": "BID_RECORDED",
  "cmd": "01JC0000000000000000000B07",
  "payload": {
    "bidId": "01JC0000000000000000000B07",
    "lotId": "01JC00000000000000000002L1",
    "bidderId": "01JC0000000000000000000BD2",
    "amountCents": 15000,
    "source": "voice",
    "audit": {
      "utteranceId": "u-81",
      "audioStartMs": 412300,
      "audioEndMs": 413900,
      "transcript": "one fifty from the back",
      "confidenceBps": 9120,
      "confirmed": true,
      "parserVersion": "p1",
      "clientTs": 1788000123100
    },
    "priceBefore": 12500,
    "priceAfter": 15000,
    "leaderBefore": "01JC0000000000000000000BD1",
    "leaderAfter": "01JC0000000000000000000BD2",
    "rank": 1,
    "endsAtBefore": 1788000130000,
    "endsAtAfter": 1788000153456
  },
  "prev": "<64 hex>",
  "hash": "<64 hex>"
}
```

Rejected example payload: `{"bidId":"...","lotId":"...","bidderId":"...","amountCents":null,"amountRaw":"150.5","source":"manual","audit":{},"reason":"bad_amount","detail":{}}`.

LOT_HAMMERED payload example:

```json
{
  "lotId": "...",
  "winnerId": "...BD2",
  "priceCents": 15000,
  "mode": "english",
  "ranking": [
    { "bidderId": "...BD2", "amountCents": 15000, "at": 1788000123456, "seq": 14 },
    { "bidderId": "...BD1", "amountCents": 12500, "at": 1788000100000, "seq": 11 }
  ],
  "candidates": [
    { "bidderId": "...BD2", "priceCents": 15000 },
    { "bidderId": "...BD1", "priceCents": 12500 }
  ],
  "endsAt": 1788000153456,
  "extensions": 1,
  "closedAtSeq": 16
}
```

`candidates` has the same shape as the saga's ranking input (bidder, price if promoted), best first.

### 4.7 Golden fixture format

```json
{
  "name": "english-boundary-01",
  "parity": true,
  "config": {
    "mode": "english",
    "reserveCents": 1000,
    "increment": { "flatCents": 500 },
    "durationMs": 100000,
    "softClose": { "windowMs": 0, "extensionMs": 0, "maxExtensions": 0 }
  },
  "steps": [
    { "op": "register", "bidder": "A", "ceilingCents": 50000, "at": 0 },
    { "op": "bid", "bidder": "A", "amountCents": 999, "at": 1000, "expectReject": "below_reserve" },
    { "op": "bid", "bidder": "A", "amountCents": 1000, "at": 2000 },
    { "op": "tick", "at": 100000 },
    { "op": "hammer", "at": 100000 }
  ],
  "expect": { "winner": "A", "priceCents": 1000, "ranking": [["A", 1000]], "endsAt": 100000 }
}
```

Bidder names (`A`, `B`) are mapped to ULIDs by the loader. Python converts `at` ms to seconds by dividing by 1000. Fixtures with ladders, cumulative ceilings, striking, fallback or holdScope are `parity:false` (the reference has no such features) and are checked against hand-derived expectations.

## 5. State machines and sequences

### 5.1 Lot status

```
          OpenLot                 Tick(at>=endsAt) | Hammer(early)            Hammer
 PENDING ---------> OPEN ---------------------------------------> CLOSING ----------> SETTLING
                      |  PlaceBid(at>=endsAt) => LOT_CLOSING + reject            |        |
                      |  Hammer with no bids  => LOT_UNSOLD ----------------+    |        | CompleteLot (price == captured)
                      |                                                     v    |        v
                      +-----------------------------------------------> DONE <--+--------+
                                         PromoteRunnerUp exhausted => LOT_UNSOLD(no_valid_winner) -> DONE
```

Legacy names: OPEN, CLOSING, SETTLING, DONE are unchanged from the reference; PENDING is new.

### 5.2 Sequence: voice bid in english mode

```
 host(realtime)            runtime                 decide/evolve               store
   | PlaceBid(at=server)     |                          |                       |
   |------------------------>| queue (FIFO)             |                       |
   |                         | decide(state,cmd)------->| validate, price,      |
   |                         |<-------events------------| soft close            |
   |                         | sealBatch(events,head)   |                       |
   |                         | append(entries, headSeq)-------------------------->|
   |                         |<----------------------------------------ack--------|
   |                         | evolve(state, entries)   |                       |
   |<--result+entries--------|  notify subscribers      |                       |
   | bid_accepted/price/audit_event broadcast (host, using projections)           |
```

### 5.3 Sequence: fallback after hold failure

```
 payments saga          host            runtime
   | capture fails definitively |          |
   |--------------------------->| RevokeCeiling(winner)     (records CEILING_REVOKED)
   |                            | PromoteRunnerUp(lot,winner)
   |                            |------------------------->| candidates recomputed without winner
   |                            |<-- FALLBACK_PROMOTED(to=B, price) or CANDIDATE_SKIPPED... or LOT_UNSOLD
   | saga proceeds with B at price; RecordSettlement(from,to) entries follow
```

### 5.4 Ceiling accounting (holdScope event)

```
 ceiling 5000
 lot1 hammer 3000 (SETTLING) -> committed 3000, available 2000
 lot2 bid 2001 -> over_ceiling       bid 2000 ok
 lot1 winner demoted by fallback -> committed 0 at demotion, available 5000 (minus standing lot2 exposure)
```

## 6. Error and edge cases

| Case                                         | Behaviour                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Two bids same ms, same amount (proxy/sealed) | Both accepted; order by `seq`, i.e. arrival at the single writer          |
| Two english bids race for the same price     | Second arrives after the first is evolved; fails below_increment          |
| Bid at exactly `endsAt`                      | LOT_CLOSING then BID_REJECTED(lot_not_open)                               |
| Bid at `endsAt - 1` inside window            | Accepted and extends if enabled                                           |
| `at` earlier than head                       | `time_regression`, nothing appended; host clamps with monotonicAt         |
| Client clock wildly off                      | Irrelevant: `clientTs` is stored only                                     |
| Bid amount 1.5 or NaN                        | Rejected `bad_amount`, `amountRaw` stored as text                         |
| Amount exactly ceiling                       | Accepted; one cent above rejected                                         |
| Winner price above remaining ceiling         | `InvariantError`, no hammer; cannot occur if validation passes            |
| Winner revoked after hammer                  | CEILING_REVOKED only; fallback is explicit                                |
| Fallback candidate lacks headroom            | CANDIDATE_SKIPPED then next candidate                                     |
| All candidates fail                          | LOT_UNSOLD(no_valid_winner); host moves settlement to FAILED_NEEDS_REVIEW |
| Duplicate delivery of PlaceBid               | `duplicate` outcome, no append                                            |
| Same commandId, different body               | `command_conflict`                                                        |
| Append outcome unknown                       | Head read, commandId lookup, no double write                              |
| Process crash after append before notify     | Restart replays; subscribers resume from last seq                         |
| Sealed lot read by public                    | Amounts hidden until hammer                                               |
| Ledger tampered in storage                   | `verifyChain` reports first bad index; replay refuses                     |
| Last entries deleted                         | Detected only against a published head (`expectedHead`)                   |
| Zero bids                                    | LOT_UNSOLD(no_bids)                                                       |
| Single bidder proxy or sealed                | Pays reserve                                                              |
| Bidder re-registers lower                    | `cannot_lower_ceiling`                                                    |
| Command after AUCTION_CLOSED                 | `auction_closed`                                                          |

## 7. Non-functional

- Latency: decide + seal + evolve median < 1 ms, p99 < 5 ms at 200 bidders and 5000 bids on Node 22 (nfr-latency). State uses persistent-style updates of the active lot only.
- Determinism: no clock, randomness, locale, or iteration-order dependence; ordered maps; integer math only; canonical JSON. A replay on any machine reproduces every hash.
- Security: ceilings and holdRefs never leave through public projections; ids validated before use; prototype keys refused; size limits; the ledger is tamper-evident but not tamper-proof (an attacker with write access can rewrite everything unless a head hash was published elsewhere, hence the anchor).
- Privacy: transcripts may identify people; they are stored in the ledger in v1 (sandbox demo) and shown to auditors only. See Q3.
- Portability: zero runtime dependencies; core imports no Node built-ins (nfr-edge).
- Observability: every decision produces entries (the audit trail) and one `onDecision` metric; rejected bids are first-class records.
- Accessibility: not applicable to this package; projections carry `reasonText` keys only, the UI owns copy.

## 8. Test specification

Each test lists the requirement ids it verifies. Inputs and expected values are concrete; implementers add more cases but never fewer.

- **T-ENG-001** [R-ENG-001, R-ENG-027] Submit amounts 0, -1, 1.5, NaN, Infinity, 100000001, '500' (string) to an open english lot; each is BID_REJECTED reason bad_amount; ledger payload has amountCents null and amountRaw string for non-integers; chain verifies.
- **T-ENG-002** [R-ENG-002] validateAuctionConfig({currency:'EUR'}) returns error code unsupported_currency at path currency.
- **T-ENG-003** [R-ENG-003, R-ENG-121] Run the full fixture suite with Date.now and Math.random replaced by throwing stubs; no test fails.
- **T-ENG-004** [R-ENG-004] Head at=2000; dispatch command at=1999 throws time_regression and store length unchanged; monotonicAt(1999,2000)=2000.
- **T-ENG-005** [R-ENG-005] PlaceBid with bidderId 'alice', lotId '', commandId lower-case ULID -> EngineError bad_id; no entries appended.
- **T-ENG-006** [R-ENG-006] RegisterBidder with bidderId '**proto**' fails; payload containing key 'constructor' fails with non_canonical; a Map-keyed state is unaffected (Object.prototype.polluted undefined).
- **T-ENG-007** [R-ENG-007] Transcript of 2001 chars, 201st lot, 1001st bidder, 20001st bid, 129-char holdRef each fail limit_exceeded; boundary values (2000, 200, 1000, 20000, 128) succeed.
- **T-ENG-008** [R-ENG-008, R-ENG-010] Lot config {reserve:0, increment:{ladder:[{fromCents:100,incrementCents:0}]}} returns 3 errors: reserve, ladder first fromCents must be 0, incrementCents >= 1; no throw.
- **T-ENG-009** [R-ENG-009] validateAuctionConfig({}) value deep-equals the defaults table; lot defaults increment flat 100, maxExtensions 10.
- **T-ENG-010** [R-ENG-011, R-ENG-037] second_price lot with windowMs 30000 fails soft_close_not_allowed_sealed; a bid at the final ms of a sealed lot never changes endsAt.
- **T-ENG-011** [R-ENG-012, R-ENG-015] windowMs 600001, extensionMs -1, maxExtensions 51, durationMs 999, hardCloseMs < durationMs each fail; after OpenLot, AddLot-style reconfigure fails lot_frozen.
- **T-ENG-012** [R-ENG-013] holdScope lot: RegisterBidder without lotId fails; holdScope event: RegisterBidder with lotId fails; each with code bad_command.
- **T-ENG-013** [R-ENG-014, R-ENG-040] CEILING_PRESETS_CENTS equals [10000,25000,50000,100000]; ceiling 99 and 100001 (cap 100000) fail bad_ceiling; 100 and 100000 succeed.
- **T-ENG-014** [R-ENG-016, R-ENG-017, R-ENG-018] reserve 1000 inc 500: A bids 999 -> below_reserve; A 1000 ok price 1000; B 1400 -> below_increment; B 1500 ok; B 2000 -> already_leading; hammer winner B price 1500.
- **T-ENG-015** [R-ENG-025, R-ENG-010] ladder [{0,100},{10000,500},{50000,1000}]: price 9999 requires next >= 10099; price 10000 requires >= 10500; price 50000 requires >= 51000.
- **T-ENG-016** [R-ENG-019, R-ENG-020] reserve 100 inc 50: A max 1000 -> price 100; B max 400 -> price 450, leader A; B raises to 1000 -> tie, A earlier leads price 1000; B 1000 again -> not_higher_than_own_max.
- **T-ENG-017** [R-ENG-021, R-ENG-024] A and B both max 700 at at=10 and at=10, seq 3 and 4: A leads; same at different seq decided by seq; price 700.
- **T-ENG-018** [R-ENG-019, R-ENG-026] A max 500, B max 480 inc 50: price = min(500, 530)=500 never above A's max.
- **T-ENG-019** [R-ENG-022, R-ENG-023] reserve 500: A 900, B 700, C 700 (later): winner A pays 700; A second bid -> already_bid; single bidder pays 500; public price null throughout OPEN.
- **T-ENG-020** [R-ENG-023] reserve 800, A 900, B 700 (B rejected below_reserve): single valid bidder A pays 800.
- **T-ENG-021** [R-ENG-024] Ten bids with duplicate amounts and equal at: ranking equals sort by (amount desc, at asc, seq asc) for 1000 shuffled insertions.
- **T-ENG-022** [R-ENG-027, R-ENG-028] Unregistered bidder bidding 0 on a closed lot -> lot_not_open; registered but revoked with amount 0 -> ceiling_revoked; each of the 12 codes reachable with a minimal input and appears in REJECT_REASONS.
- **T-ENG-023** [R-ENG-030] voice bid confidenceBps 8499 confirmed undefined -> unconfirmed; same with confirmed true -> accepted; confidenceBps 8500 unconfirmed -> accepted; manual bid with no confidence accepted.
- **T-ENG-024** [R-ENG-031, R-ENG-082, R-ENG-076] A rejected bid appends exactly 1 entry of type BID_REJECTED; stateDigest before and after equal except head.
- **T-ENG-025** [R-ENG-032] There is no exported command or function that removes a bid; after BID_STRUCK the bid is still present in the ledger with status struck.
- **T-ENG-026** [R-ENG-033, R-ENG-035] endsAt 10000; bid at 10000 yields entries [LOT_CLOSING(deadline), BID_REJECTED(lot_not_open)] in one batch with equal at; bid at 9999 accepted.
- **T-ENG-027** [R-ENG-034, R-ENG-035, R-ENG-038, R-ENG-039] endsAt 100000 window 30000 ext 30000: bid at 69999 no extension; at 70000 -> endsAt 100000 (max(100000,100000)); at 99999 -> endsAt 129999 with END_EXTENDED after BID_RECORDED; a rejected bid at 99998 changes nothing.
- **T-ENG-028** [R-ENG-036] maxExtensions 3 and hardCloseMs 120000 from open at 0 duration 100000: repeated late bids stop extending after 3, and endsAt never exceeds 120000.
- **T-ENG-029** [R-ENG-081, R-ENG-083, R-ENG-084, R-ENG-086] Accepted voice bid payload contains every required field with priceBefore null on first bid; source 'phone' fails bad_command; confidenceBps 10001 fails.
- **T-ENG-030** [R-ENG-085] Two bids with clientTs in reverse order of arrival: ranking uses server at and seq only; changing clientTs does not change any outcome or any hash except the payload that contains it.
- **T-ENG-031** [R-ENG-042, R-ENG-040] ceiling 50000, bid 50001 -> over_ceiling, bid 50000 accepted.
- **T-ENG-032** [R-ENG-041] ceiling 50000 re-registered at 40000 and at 50000 -> cannot_lower_ceiling; at 60000 -> CEILING_RAISED entry; bids up to 60000 now accepted.
- **T-ENG-033** [R-ENG-046, R-ENG-045] holdRef 'AUTH-123' appears in the auditor projection and ledger but not in projectPublic nor projectBidder of another bidder (string scan).
- **T-ENG-034** [R-ENG-044, R-ENG-029] A leads english at 3000, B at 2500 behind; RevokeCeiling A: entries CEILING_REVOKED then BID_STRUCK for each A bid; leader becomes B at price 2500; A's next bid -> ceiling_revoked; unregistered C -> unregistered.
- **T-ENG-035** [R-ENG-044] RevokeCeiling after hammer appends only CEILING_REVOKED; the outcome and lot status are unchanged.
- **T-ENG-036** [R-ENG-047, R-ENG-052] Hammer on OPEN without early -> cannot_hammer; with early:true -> [LOT_CLOSING(early), LOT_HAMMERED] and actor recorded; Hammer twice -> cannot_hammer.
- **T-ENG-037** [R-ENG-048, R-ENG-050, R-ENG-051] english bids A 1000, B 1500, C 2000, depth 2: winner C price 2000 candidates [C 2000, B 1500, A 1000]; payload has every required field.
- **T-ENG-038** [R-ENG-049, R-ENG-068] Hammer with no bids -> LOT_UNSOLD(no_bids) and status DONE; then PlaceBid -> lot_done.
- **T-ENG-039** [R-ENG-053] nextDeadline returns endsAt while OPEN, null after closing; Tick at endsAt-1 appends nothing and returns noop; Tick at endsAt appends LOT_CLOSING.
- **T-ENG-040** [R-ENG-054, R-ENG-055, R-ENG-059, R-ENG-058] After hammer C 2000, PromoteRunnerUp(C) -> FALLBACK_PROMOTED to B at 1500 depth 1; B's committed becomes 1500, C's 0.
- **T-ENG-041** [R-ENG-055, R-ENG-019] proxy A max 900, B max 600, C max 300 inc 50: hammer A price 650; promote after disqualifying A: B pays 350 (max(reserve, min(600, 300+50))).
- **T-ENG-042** [R-ENG-055, R-ENG-023] sealed A 900, B 700, C 500 reserve 400: winner A pays 700; after A disqualified B pays 500; then C pays reserve 400.
- **T-ENG-043** [R-ENG-056, R-ENG-043] event scope ceiling 3000: B won lot 1 at 2000 and then bids 1500 on lot 2 as runner-up; promoting B on lot 2 at 1500 exceeds available 1000 -> CANDIDATE_SKIPPED(ceiling_insufficient) and next candidate considered.
- **T-ENG-044** [R-ENG-057, R-ENG-060] maxFallbackDepth 1 with three bidders: third promotion yields LOT_UNSOLD(no_valid_winner); fallbackPolicy unsold yields it on the first promotion.
- **T-ENG-045** [R-ENG-054] PromoteRunnerUp naming a bidder who is not the current winner, or on an OPEN lot -> EngineError not_current_winner / cannot_promote.
- **T-ENG-046** [R-ENG-061, R-ENG-062, R-ENG-065] Open lot 2 before lot 1 -> out_of_order; open lot 2 while lot 1 CLOSING -> lot_in_progress; after lot 1 SETTLING lot 2 opens; bids in lot 2 do not alter lot 1 ranking.
- **T-ENG-047** [R-ENG-063, R-ENG-043, R-ENG-069] ceiling 5000 event scope: win lot 1 at 3000 -> available on lot 2 is 2000, bid 2001 -> over_ceiling; hold scope lot with per-lot ceilings keeps full amount on lot 2.
- **T-ENG-048** [R-ENG-064] CloseAuction with a lot SETTLING fails auction_open_lots; after all DONE appends AUCTION_CLOSED with head anchor; later RegisterBidder fails auction_closed.
- **T-ENG-049** [R-ENG-066, R-ENG-068] CompleteLot capturedCents 1500 when price 2000 -> capture_mismatch and nothing appended; 2000 -> LOT_SETTLED, lot DONE.
- **T-ENG-050** [R-ENG-067] RecordSettlement from HELD to CAPTURING ok; next with from HELD again -> state_continuity; to 'PAID' -> bad_command.
- **T-ENG-051** [R-ENG-069] Force a LOT_SETTLED that would put captured total above ceiling via a crafted state -> InvariantError and no entry.
- **T-ENG-052** [R-ENG-072, R-ENG-070, R-ENG-071] The two-entry golden vector in section 4.5 hashes to e1d36276...5540 and f685ed77...5b13 in both TypeScript and Python.
- **T-ENG-053** [R-ENG-071] Canonical output for {b:1,a:[2,{d:1,c:2}],e:'\u00e9'} is exact; 1.5, -0, NaN, undefined, lone surrogate each throw non_canonical; key order independent of insertion order.
- **T-ENG-054** [R-ENG-079, R-ENG-120] NIST vectors '', 'abc', 448-bit message, 1,000,000 x 'a' match; implementation file imports nothing from node:\*.
- **T-ENG-055** [R-ENG-073, R-ENG-070] Entries start at seq 1; gaps or duplicates fail verification with reason bad_seq; at decreasing fails bad_time.
- **T-ENG-056** [R-ENG-074, R-ENG-080] For a 40-entry ledger, mutate each entry's payload byte, at, type, prev, hash, v in turn: verifyChain reports firstBadIndex equal to that entry (or the next for hash-only) every time.
- **T-ENG-057** [R-ENG-074] Delete middle entry, swap two entries, duplicate an entry, truncate tail: each reported; truncation only with expectedHead.
- **T-ENG-058** [R-ENG-075, R-ENG-078] headOf(entries) equals the hash printed by `verify-ledger` for the same JSONL; verifyJsonl detects a tampered line and a trailing blank line is tolerated.
- **T-ENG-059** [R-ENG-076, R-ENG-104] A command producing 3 entries is appended in one store call; fault injection failing before commit leaves 0 of 3.
- **T-ENG-060** [R-ENG-077] Object.isFrozen on every entry and nested payload; assignment throws in strict mode.
- **T-ENG-061** [R-ENG-087, R-ENG-091] Dispatch the same PlaceBid twice: second result outcome duplicate with the original entries, ledger length unchanged, no second extension.
- **T-ENG-062** [R-ENG-088] Same commandId, amount 1500 then 1600 -> command_conflict.
- **T-ENG-063** [R-ENG-089] Command type 'Withdraw' and extra field 'foo' -> bad_command.
- **T-ENG-064** [R-ENG-090] Deep-freeze state and command, call decide: no throw; calling twice yields deep-equal events.
- **T-ENG-065** [R-ENG-092, R-ENG-093, R-ENG-095] For every prefix of the demo ledger, stateDigest(live) == stateDigest(replay(prefix)).
- **T-ENG-066** [R-ENG-094] replay on a tampered ledger throws ChainError and never returns state.
- **T-ENG-067** [R-ENG-095] evolve with an entry of type 'FOO' throws unknown_entry_type.
- **T-ENG-068** [R-ENG-096] Run fixture english-01 with every at shifted by +86400000: same winner, prices, reject reasons.
- **T-ENG-069** [R-ENG-097] 100 random permutations of a sealed bid set with distinct at: identical outcome.
- **T-ENG-070** [R-ENG-098, R-ENG-099] Fire 200 concurrent dispatch calls (Promise.all): seq 1..N contiguous, order equals call order; fresh runtime on the same store reproduces the digest.
- **T-ENG-071** [R-ENG-100] Store acknowledgement delayed 50 ms by a fake: no result or notification before it resolves.
- **T-ENG-072** [R-ENG-101] Second runtime appends concurrently: first retries after rehydrate and succeeds; 4 consecutive conflicts surface store_conflict.
- **T-ENG-073** [R-ENG-102, R-ENG-087] Store persists then throws timeout: runtime reads head, finds commandId, returns the original result with exactly one entry stored.
- **T-ENG-074** [R-ENG-103] Subscriber from seq 5 on a ledger of 10 then 3 live appends receives 5..13 once each in order.
- **T-ENG-075** [R-ENG-104] Contract kit passes for InMemoryLedgerStore: ordered read, head, conflict on stale expectedHeadSeq, atomic batch, large batches.
- **T-ENG-076** [R-ENG-105] Hook receives one call per command with durations; a throwing hook does not change the dispatch result.
- **T-ENG-077** [R-ENG-106, R-ENG-045, R-ENG-110] JSON scan of projectPublic output: no ceilingCents, holdRef, committed; leader appears as alias only.
- **T-ENG-078** [R-ENG-107] projectBidder(A) includes A's ceiling and available; projectBidder(B) does not include A's.
- **T-ENG-079** [R-ENG-109, R-ENG-108, R-ENG-023] While sealed lot OPEN, public JSON contains none of the submitted amounts 1234, 5678; auditor projection without full:true redacts them; after hammer they appear.
- **T-ENG-080** [R-ENG-111] All fixture files validate; a fixture with unknown step op fails the loader with its file name.
- **T-ENG-081** [R-ENG-112, R-ENG-113] At least 40 parity fixtures: TypeScript runner and python golden_runner.py both pass; results compared field by field.
- **T-ENG-082** [R-ENG-114] Exporter with seed 20261104 writes 2000 scenarios; TypeScript compares winner, price, ranking, reasons; any mismatch prints the scenario JSON.
- **T-ENG-083** [R-ENG-115, R-ENG-116] demo-gala.json replays to the pinned head hash and settlement table; legacy Auction tests pass unchanged.
- **T-ENG-084** [R-ENG-117, R-ENG-118] Benchmark: 5000 bids / 200 bidders median < 1 ms p99 < 5 ms per decision; 10000 entry replay < 500 ms (thresholds loosened 3x in CI via env if flaky, never removed).
- **T-ENG-085** [R-ENG-119, R-ENG-125, R-ENG-126] package.json has no dependencies; api.snapshot.txt matches exports; README contains headings Commands, Ledger format, Hash vector, Fixtures.
- **T-ENG-086** [R-ENG-124, R-ENG-122, R-ENG-123] trace script exits 1 on a seeded missing id; coverage thresholds 95/90 enforced in vitest config; workflow file lists all steps.

### 8.1 Property tests (fast-check, seeded; 500 runs per property locally, 5000 nightly)

1. Winner price <= winner ceiling; sum captured per bidder <= ceiling (ENG-48, ENG-49).
2. One winner, equal to ranking[0], or none (ENG-48).
3. English price never decreases; each accepted bid raises it by >= increment (ENG-48).
4. Proxy price non-decreasing, <= top maximum, >= reserve (ENG-48).
5. Vickrey: truthful bidding weakly dominates; revenue equivalence toy check (ENG-50).
6. Soft close: endsAt non-decreasing, extensions <= max, endsAt <= hard close (ENG-51).
7. Ledger: any single mutation detected; replay digest equals live digest at every prefix (ENG-52).
8. Idempotency, time shift, arrival-order invariance (ENG-53).

### 8.2 Fault injection matrix (ENG-55)

| Fault                           | Where        | Expected                                           |
| ------------------------------- | ------------ | -------------------------------------------------- |
| Fail before commit              | store.append | no entries, command retriable, same commandId safe |
| Fail after commit (torn)        | store.append | no duplicate entry (rt-torn)                       |
| Ack delayed                     | store        | no early notification                              |
| Concurrent writer               | store        | retry after rehydrate, then store_conflict after 3 |
| Process restart mid-lot         | runtime      | rehydrate gives identical digest                   |
| Clock goes backwards            | host input   | time_regression, nothing written                   |
| Duplicate delivery              | host         | duplicate outcome                                  |
| Subscriber slow or disconnected | subscribe    | resume from seq without gaps                       |

### 8.3 Fixtures

Sixty hand-checked fixtures (14 english, 12 proxy, 10 sealed, 10 soft close, 8 reject order, plus extras) and `demo-gala.json`. Every fixture file carries its test id in `name`.

## 9. Open questions

| #   | Question                                                                                             | Decision owner                     | Default until decided                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Q1  | holdScope `event` (one hold, several partial captures; UNVERIFIED (G1)) or `lot` (one hold per lot)? | Harsh with payments owner after G1 | `event` in engine; demo runs a single lot per bidder hold, so `lot` is a config change, not a code change |
| Q2  | Should pre-engine parse failures (unparseable audio) be ledger entries?                              | Voice and realtime owners          | No: the engine ledger records only commands that reached it; voice records its own `audit_event` rows     |
| Q3  | Store transcripts in the ledger in plain text? Retention and redaction of PII.                       | Harsh                              | Plain text in the sandbox demo; auditor-only access                                                       |
| Q4  | Does a bid that leaves price and leader unchanged (proxy) extend the soft close?                     | Harsh                              | Yes, as in the reference engine                                                                           |
| Q5  | Carry the ledger head hash into a PayPal capture field (UNVERIFIED (G1))?                            | Payments owner                     | No; show the head hash only in the receipt UI                                                             |
| Q6  | Is `hardCloseMs` on by default?                                                                      | Harsh                              | Off by default, set in the gala fixture                                                                   |
| Q7  | Who owns the settlement transition graph validation?                                                 | Payments owner                     | Payments; engine checks only continuity of `from`                                                         |

## 10. Traceability

`DEPS.md` holds the table mapping every R-ENG and T-ENG id to its issue key. `scripts/trace-check.mjs` (ENG-10) enforces that test titles carry T-ENG ids and cover R-ENG ids.
