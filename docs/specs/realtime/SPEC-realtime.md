# SPEC-realtime: shared contracts and room server (RT)

Status: draft for build, 4 Nov 2026. Owner area: realtime (packages/shared, packages/server). Key prefix: RT-. Requirement ids R-RT-nnn, test ids T-RT-nnn.

## 1. Purpose and scope

GAVEL runs a live ascending auction in which each bid is backed by a payment hold. This spec covers the layer between the pure engine and everything that talks to people and to PayPal:

- `packages/shared`: ids, money, time, zod schemas, wire messages, persisted event records, error codes and the port interfaces other packages implement.
- `packages/server`: one single-writer room per auction, HTTP and WebSocket hosting, persistence adapters (memory, Postgres, optionally D1), snapshots and resync, reconnect, token auth for auctioneer, bidder and screen, rate limits and caps, join/invite tokens, the webhook HTTP route that hands raw events to packages/payments, config, logging, health and metrics, and the host decision (Durable Object versus Node).

In scope: everything above, including the demo path (scripted auction, replay feed) and the test harness that other areas reuse.
Out of scope: auction rules (engine), PayPal calls, saga and webhook signature verification (payments), audio and parsing (voice), UI (web), Playwright suites and workflows (quality, infra).

Every external dependency of the room sits behind an interface in `ports.ts` with an in-memory or fake implementation, so all room tests run without network, keys or a database.

## 2. Definitions

- Room: the in-memory state machine for one auction plus its mailbox. Exactly one live Room per auction.
- Mailbox: FIFO queue; the only way to mutate a Room.
- Event: an immutable record appended to the log with gapless `seq` (1..n). The log is the source of truth; Room state is derived.
- Frame: one JSON message on the socket.
- Role: `auctioneer`, `bidder`, `screen`. Admin key holders are operators, not a socket role.
- Invite: single-use token that a bidder exchanges for a session token.
- Hold: payment authorization owned by packages/payments. RT sees only `hold reported` and settlement updates.
- Server time: epoch milliseconds from the Clock port; the only time used for ordering and closing.
- Host: the process model that runs the room core (Node server or Durable Object).
- Ceiling: the amount a bidder's hold covers; private to its owner.
- Cents: integer minor units of USD. $350.00 is `35000`.
- UNVERIFIED (spike): platform behaviour not yet measured; each states a fallback.

## 3. Requirements

Each requirement is testable and appears in the Coverage table in DEPS.md. MUST is mandatory, SHOULD is desirable.

### 3.1 Shared contracts (ids, money, time, errors, schemas)

- **R-RT-001** Ids MUST be 26-char Crockford ULID strings with branded TypeScript types (AuctionId, BidderId, BidId, MsgId, ConnId, EventId, Jti); `parseId` MUST reject wrong length, lowercase-invalid chars (I L O U) and overflow of the 48-bit time prefix.
- **R-RT-002** The id minter MUST be monotonic: ids minted in the same millisecond strictly increase, and ids sort lexicographically in mint order.
- **R-RT-003** Id minting MUST sit behind an `Ids` port with a deterministic `SeqIds` fake (`01TEST000000000000000000NN` style) for tests.
- **R-RT-004** Money MUST be a branded integer `Cents` (0..99_999_999_999). Constructors MUST reject floats, NaN, negatives and out-of-range values with `bad_amount`.
- **R-RT-005** `formatUsd(cents)` and `parseUsd(text)` MUST round-trip for all valid values without floating-point arithmetic; `parseUsd` accepts `350`, `350.5`, `$350.50`, `1,250` and rejects three decimals.
- **R-RT-006** Money arithmetic helpers (`add`, `sub`, `cmp`, `min`, `max`) MUST be checked: results outside range throw `bad_amount`; `sub` below zero throws.
- **R-RT-007** `EpochMs` MUST be a branded integer; the `Clock` port exposes `now()`; `SystemClock` and `ManualClock` MUST be provided.
- **R-RT-008** `Clock` MUST expose `setTimer(atMs, fn)` returning a cancel function; `ManualClock.advanceTo(t)` MUST fire due timers in (time, registration) order, each seeing `now()` equal to its due time.
- **R-RT-009** `ErrorCode` MUST be a closed enum; each code has a fixed HTTP status, WebSocket close code (or none) and `retryable` flag in one table in `packages/shared/src/errors.ts`.
- **R-RT-010** `ApiError` MUST be `{code, message, detail?}` validated by zod; `message` MUST NOT contain tokens, secrets or stack traces.
- **R-RT-011** `AuctionConfig` zod schema MUST cover mode (default `english`), currency (`USD` only), reserve, minIncrement, endTs, softCloseWindowMs, softCloseExtensionMs, maxExtensions, ceilingPresets, confirmConfidenceThreshold, autoHammerDelayMs, and be `.strict()`.
- **R-RT-012** `AuctionConfig` boundaries: reserve >= 100 and a multiple of 1 cent; minIncrement >= 1; endTs in the future at creation; softCloseExtensionMs <= 600_000; maxExtensions <= 50; presets sorted ascending, 1..8 entries, each >= reserve.
- **R-RT-013** `SettlementState` MUST be exactly: HELD, BIDDING, WINNER_SELECTED, CAPTURING, CAPTURED, VOIDING, SETTLED, FALLBACK_RUNNER_UP, FAILED_NEEDS_REVIEW.

### 3.2 Wire protocol and persisted events

- **R-RT-014** Every frame MUST be a JSON object `{v:1, t:<name>, ...}`; unknown `t`, unknown fields and frames over 16 KiB MUST be rejected with `bad_message` (strict schemas).
- **R-RT-015** Client-to-server schemas: `join`, `bid`, `confirm_response`. Nothing else is accepted on the socket.
- **R-RT-016** Server-to-client schemas: `registered`, `bid_accepted`, `bid_rejected`, `price`, `state`, `confirm_request`, `hammer`, `settlement_update`, `audit_event`, `error`.
- **R-RT-017** Every server frame after a successful join MUST carry `seq` (integer, per-room, gapless) and `ts` (server epoch ms), except `error` frames that have no event behind them (`seq` omitted).
- **R-RT-018** `encodeMsg` and `decodeMsg` MUST return a Result and never throw on arbitrary input (property: fuzzed strings and bytes).
- **R-RT-019** `audit_event` payload MUST carry: bidId, bidderId, source (voice|qr|manual), audioTsMs?, transcript?, parsedAmount?, confidence?, confirmed?, outcome (accepted|rejected|expired|superseded), reason?, serverTs, seq.
- **R-RT-020** `RoomEvent` union (persisted log record) MUST be a zod discriminated union with gapless `seq` starting at 1; types: auction_created, bidder_registered, bid_accepted, bid_rejected, confirm_requested, confirm_resolved, control, state_changed, hammered, settlement_update; ceiling_raised (D-0035).
- **R-RT-021** Golden JSON fixtures for every message and every RoomEvent MUST live in `packages/shared/fixtures/` and round-trip byte-stably through decode then encode.
- **R-RT-022** Port interfaces (`RoomStore`, `PaymentsPort`, `EnginePort`, `Logger`, `TokenSigner`) MUST be declared in `packages/shared/src/ports.ts`; no implementation code lives there.
- **R-RT-023** `join` MUST carry the client protocol version; a version other than 1 MUST be answered with `error unsupported_version` and a close.

### 3.3 Room behaviour

- **R-RT-030** All mutations of a room MUST pass through one FIFO mailbox processed strictly one at a time (single writer).
- **R-RT-031** `seq` MUST be assigned gapless from 1 at dequeue time and `serverTs` taken from the Clock at dequeue; any client-supplied timestamp is advisory metadata only and never used for ordering.
- **R-RT-032** Events MUST be appended to the store before any broadcast or reply that depends on them (write-ahead).
- **R-RT-033** If the store append fails, state MUST NOT change, nothing is broadcast, the sender gets `error store_unavailable` (retryable), and the room stays usable.
- **R-RT-034** Bids MUST be idempotent by `(bidderId, mid)`: a replay returns the original `bid_accepted` or `bid_rejected` and appends no event, also after restart.
- **R-RT-035** Bid pipeline order: rate limit, role check, schema, registered, paused, engine validation. Engine `Rejected.code` values MUST map one-to-one to `bid_rejected.reason` codes.
- **R-RT-036** On accept: `bid_accepted` to the sender and `price` {price, leaderId, endTs, minNext} broadcast to every connection, both carrying the same seq of the accepting event.
- **R-RT-037** `bid_rejected` MUST go to the sender only, carry reason and `retryable`, and be audited.
- **R-RT-038** Every accepted bid, rejected bid, confirmation outcome and control action MUST produce a persisted `audit_event`.
- **R-RT-039** Bidder identity MUST come from the verified token only; a client-supplied bidderId is ignored except on auctioneer manual bids.
- **R-RT-040** Auctioneer manual bids MUST use source `manual`, name an already registered bidder, and record the auctioneer token `sub` in the audit event.
- **R-RT-041** At `endTs` a Clock timer MUST tick the engine to CLOSING and broadcast `state`; the timer MUST be re-armed after every extension.
- **R-RT-042** Soft-close extension MUST follow the engine rule (bid within window extends to ts+extension, up to maxExtensions) and the new `endTs` MUST appear in the same `price` frame.
- **R-RT-043** A bid whose server time equals `endTs` is closed (`closed`); one at `endTs - 1` is accepted; verified at the boundary under ManualClock.
- **R-RT-044** If `autoHammerDelayMs` is set, the room MUST call hammer that many ms after entering CLOSING unless the auctioneer already did.
- **R-RT-045** A voice bid with confidence below `confirmConfidenceThreshold` (default 0.85) or flagged ambiguous MUST yield `confirm_request` to its bidder and be held pending with a 15 s TTL; the engine MUST NOT be touched until acceptance.
- **R-RT-046** `confirm_response` accept runs the normal pipeline with server time at acceptance; reject or TTL expiry writes an audit event `rejected|expired` and creates no bid.
- **R-RT-047** At most one pending confirmation per bidder; a new voice bid supersedes the old one (audited `superseded`).
- **R-RT-048** Auctioneer controls open, pause, resume, extend, hammer MUST be HTTP commands, role `auctioneer` only, idempotent by `controlId`, audited.
- **R-RT-049** While paused, bids are rejected `auction_paused` and the close timer is stopped; resume shifts `endTs` by the paused duration (requires engine support, see DEPS).
- **R-RT-050** Hammer MUST be valid in CLOSING, or in OPEN via `closeNow`; it broadcasts one `hammer` {winnerId|null, price, ranking}; repeated hammer calls return the same result and append no event.
- **R-RT-051** The hammer outcome MUST be handed to `PaymentsPort.settle` exactly once per auction, idempotent by auctionId, including after crash and restart.
- **R-RT-052** Inbound settlement updates MUST be schema-validated, deduplicated, ordered by `rev` (stale rev dropped), persisted and broadcast; non-winners receive their own state only plus the public auction-level state.
- **R-RT-053** The room MUST reach DONE only when the auction-level settlement state is SETTLED or FAILED_NEEDS_REVIEW.
- **R-RT-054** When payments reports a hold, the room MUST append `bidder_registered`, send `registered` {bidderId, ceiling, paddle} to that bidder and broadcast a roster delta without ceilings. A registered bidder whose new hold is larger is raised in place: the room appends `ceiling_raised`, sends `registered` with the new ceiling and everyone else a snapshot (D-0035).
- **R-RT-055** Ceilings MUST be visible only to their owner and the server; screen and other bidders never receive them; the auctioneer view shows hold state, not ceiling.
- **R-RT-056** `state` MUST be a full role-filtered snapshot at a given seq (config, status, price, leader, endTs, roster, last 50 audit rows, settlement).
- **R-RT-057** `join` with `lastSeq`: if the gap is <= 200 events and still retained, replay the missed frames then send `state`; otherwise send `state` only. Clients dedupe by seq.
- **R-RT-058** The same session token MAY hold up to 3 concurrent connections; the oldest is closed with `superseded` beyond that.
- **R-RT-059** A room MUST be rebuildable by replaying its event log through a fresh engine; derived state MUST equal the pre-crash state exactly (determinism).
- **R-RT-060** Recovery MUST re-arm timers and, for a room that was hammered but not settled, resume settlement by re-calling `PaymentsPort.settle`.
- **R-RT-061** Only one host may append to a room: an append with a stale `expectedSeq` MUST fail with `conflict`, and the losing host MUST stop serving that room.
- **R-RT-062** Rooms load lazily, are evicted after 15 min idle with no connections once DONE, and obey the instance room cap.

### 3.4 Transport

- **R-RT-070** Room logic MUST talk to sockets only through a `Transport` abstraction; a `MemoryTransport` implements it for tests.
- **R-RT-071** Each connection has a bounded outbound queue (256 frames); a consumer that overflows or does not drain for 5 s MUST be closed with code 4008 and reconnect via resync; other connections are unaffected.
- **R-RT-072** Per-connection delivery order MUST equal seq order.
- **R-RT-073** A connection MUST send `join` within 5 s or be closed (4001); any frame before join is rejected; server pings every 20 s and drops after 2 missed pongs.
- **R-RT-074** The Node WebSocket host MUST enforce an Origin allowlist, 16 KiB max payload and the close-code table, and reject non-upgrade requests on `/ws`.

### 3.5 Authentication and authorization

- **R-RT-080** Tokens MUST be `base64url(payload).base64url(HMAC-SHA256)` verified with constant-time comparison, fixed algorithm, no algorithm field accepted from input.
- **R-RT-081** Payload: `{kind: invite|session|auctioneer|screen, aud: auctionId, sub, bidderId?, jti, iat, exp}`; wrong aud, expired, or wrong kind for the route MUST be rejected.
- **R-RT-082** Verification MUST accept `TOKEN_SECRET` and `TOKEN_SECRET_PREVIOUS`; signing uses only the current one.
- **R-RT-083** An invite token MUST be single use: exchange consumes its `jti` atomically in the store and returns a session token; a second exchange fails `invite_used`.
- **R-RT-084** Auctioneer tokens MUST be revocable via a jti denylist and a rotate endpoint that returns a new link.
- **R-RT-085** Authorization MUST be enforced centrally from one role-by-operation matrix (see Interfaces) with a test per cell.
- **R-RT-086** `screen` tokens are read-only: no bids, no controls, no ceilings in any frame.

### 3.6 Persistence

- **R-RT-090** `RoomStore` MUST provide appendEvents(expectedSeq), readEvents(from,limit), saveSnapshot/loadSnapshot, consumeJti, jti denylist, journal get/put with version check, and ping.
- **R-RT-091** One contract test suite (`runStoreContract(factory)`) MUST run against every adapter.
- **R-RT-092** A `MemoryStore` MUST implement the full contract and be the default for tests and demo.
- **R-RT-093** A Postgres adapter MUST append atomically in one transaction with a unique (auction_id, seq); migrations are versioned and forward-only.
- **R-RT-094** A D1 adapter MUST append atomically via a single batch with the same uniqueness constraint; built only if the host decision keeps D1 in play.
- **R-RT-095** Snapshots MUST be saved every 100 events and on every state change; recovery MUST also work with no snapshot.
- **R-RT-096** Migrations MUST run at boot under an advisory lock, be idempotent, and record applied versions.
- **R-RT-097** Event rows are never deleted or updated; the export endpoint streams them in seq order.

### 3.7 HTTP surface

- **R-RT-100** All HTTP errors MUST use `{code, message}` with the status from the error table; every response carries `x-request-id`.
- **R-RT-101** `POST /api/auctions` (admin key) validates `AuctionConfig`, creates the room and returns auctionId, auctioneer link and screen link.
- **R-RT-102** `GET /api/auctions/:id` returns a public summary (title, status, endTs, bidder count, and the standing price and leader paddle once a bid exists) with no secrets.
- **R-RT-103** `POST /api/auctions/:id/invites` (auctioneer) mints invites; `POST /api/auctions/:id/join` exchanges an invite for a session token.
- **R-RT-104** `GET /api/auctions/:id/snapshot` and `GET /api/auctions/:id/events?after=&limit=` return role-filtered data with the same schemas as the wire.
- **R-RT-105** CORS allowlist, JSON-only, 64 KiB body limit, 415/413 on violations.
- **R-RT-106** `POST /api/auctions/:id/control` implements R-RT-048 with body `{controlId, action, ...}`.
- **R-RT-107** With `DEMO_MODE=1`, `POST /api/demo/reset` and `POST /api/demo/seed` (admin key) reset or create the scripted auction; both are 404 when the flag is off.
- **R-RT-108** `GET /api/auctions/:id/export` streams the full event log as NDJSON; `ReplayFeed` re-emits it through a Clock at 1x..16x for replay mode.

### 3.8 Webhook plumbing

- **R-RT-110** `POST /webhooks/paypal` MUST read the raw body bytes unparsed and pass them to the payments webhook handler. The payments API is `WebhookHandler.handle(rawBody, headers)` returning `{ status }` (200 stored, 401 failed verification, 503 retry); the server adapts it to the `PaymentsPort.handleWebhook({rawBody, headers})` shape below (`portFromService` in `packages/server/src/http/webhook.ts`), and no payments type named `handleWebhook` is required.
- **R-RT-111** Result mapping: `ok|duplicate` -> 200, `invalid_signature` (handler status 401) -> 400, `retry` -> 503. PayPal's retry schedule is UNVERIFIED (gate G4); the route stays correct for any schedule.
- **R-RT-112** Body limit 256 KiB; no auth beyond the verifier; the route logs event id and outcome, never the body or headers beyond an allowlist.
- **R-RT-113** Webhook handling MUST NOT block rooms: resulting settlement updates enter the room through its mailbox.
- **R-RT-114** A webhook for an unknown auction MUST return 200 with a warning log so the sender is not told to retry forever.

### 3.9 Rate limits and caps

- **R-RT-120** Token-bucket limits: bids 3/s burst 5 per bidder; frames 20/s burst 40 per connection; joins 10/min per IP; HTTP 60/min per IP (webhooks exempt). Exceeded -> `rate_limited` with `retryAfterMs`, no state change.
- **R-RT-121** Caps: 500 connections per room, 3 per bidder, 200 bidders per room, 20 rooms per instance, 5000 bids per auction; all configurable.
- **R-RT-122** Cap and rate-limit hits MUST be counted in metrics and never crash or stall other rooms.

### 3.10 Config, logging, operations

- **R-RT-130** A zod config schema MUST validate env at boot, list all errors together and exit non-zero; dumped config redacts secrets.
- **R-RT-131** Production mode (`NODE_ENV=production`) MUST require TOKEN_SECRET >= 32 bytes, ADMIN_KEY >= 24 chars and a non-memory store unless `ALLOW_MEMORY_STORE=1`.
- **R-RT-132** Logs MUST be JSON lines with ts, level, msg and context; tokens, secrets and Authorization values MUST be redacted by key and by pattern.
- **R-RT-133** Log context MUST include reqId, connId, auctionId and seq where applicable.
- **R-RT-134** `GET /healthz` returns 200 if the process is up; `GET /readyz` returns 200 only when the store ping passes and migrations are applied.
- **R-RT-135** `GET /metrics` returns JSON: connections, rooms, bids accepted/rejected, mailbox depth, bid latency p50/p95/p99, store append latency, webhook outcomes, rate-limit hits.
- **R-RT-136** On SIGTERM the server MUST stop accepting, drain mailboxes, close sockets with 1001 and exit within 10 s.
- **R-RT-137** `GET /ops/rooms` (admin key) lists loaded rooms with seq, status, connections and mailbox depth.

### 3.11 Hosting decision

- **R-RT-140** Room core MUST be runtime-agnostic: no `node:` imports, only WebCrypto, Clock, Ids and ports, so it runs in Node and in a Durable Object.
- **R-RT-141** A spike MUST compare a Durable Object host and the Node host on latency, restart recovery, cost and complexity and record the decision in docs/DECISIONS.md by end of D2.
- **R-RT-142** Default decision: Node host with Postgres; a Durable Object host is built only if the spike passes every criterion in the decision table.
- **R-RT-143** If chosen, the Durable Object host MUST reuse the room core unchanged; hibernation and free-plan limits are UNVERIFIED (spike).

### 3.12 Non-functional targets

- **R-RT-150** Latency targets (server side, MemoryStore, local): bid accept to last broadcast p95 < 50 ms; with Postgres on localhost p95 < 150 ms; snapshot of 500 bids < 200 ms.
- **R-RT-151** Determinism: same event log plus same Clock and Ids yield byte-identical outputs; no `Math.random` or `Date.now` in room core (lint rule).
- **R-RT-152** Load: 100 connected bidders at 10 bids/s sustained for 60 s with zero ordering violations and no mailbox depth above 50.
- **R-RT-153** A room with 5000 events MUST recover in under 2 s and hold under 20 MB of heap.

## 4. Interfaces

### 4.1 Wire envelope and messages (packages/shared/src/wire)

```ts
export const PROTOCOL_VERSION = 1 as const;
type Base = { v: 1 };

// client -> server
export type JoinMsg = Base & {
  t: 'join';
  token: string;
  auctionId: AuctionId;
  lastSeq?: number;
  client?: { name: string; version: string };
};
export type BidMsg = Base & {
  t: 'bid';
  mid: MsgId;
  amount: Cents;
  source: 'qr' | 'voice' | 'manual';
  bidderId?: BidderId; // honoured only for auctioneer + source 'manual'
  transcript?: string;
  confidence?: number;
  ambiguous?: boolean;
  audioTsMs?: number;
  clientTs?: EpochMs;
};
export type ConfirmResponseMsg = Base & {
  t: 'confirm_response';
  confirmId: string;
  accept: boolean;
};

// server -> client (all after join carry seq + ts)
type Ev = Base & { seq: number; ts: EpochMs };
export type RegisteredMsg = Ev & {
  t: 'registered';
  bidderId: BidderId;
  paddle: number;
  ceiling?: Cents /* owner only */;
  role: Role;
};
export type BidAcceptedMsg = Ev & { t: 'bid_accepted'; mid: MsgId; bidId: BidId; amount: Cents };
export type BidRejectedMsg = Ev & {
  t: 'bid_rejected';
  mid: MsgId;
  reason: ErrorCode;
  retryable: boolean;
  retryAfterMs?: number;
};
export type PriceMsg = Ev & {
  t: 'price';
  price: Cents;
  leaderId: BidderId | null;
  leaderPaddle: number | null;
  endTs: EpochMs;
  minNext: Cents;
  extensions: number;
};
export type StateMsg = Ev & { t: 'state'; snapshot: RoomSnapshot };
export type ConfirmRequestMsg = Ev & {
  t: 'confirm_request';
  confirmId: string;
  amount: Cents;
  transcript?: string;
  expiresAt: EpochMs;
};
export type HammerMsg = Ev & {
  t: 'hammer';
  winnerId: BidderId | null;
  price: Cents;
  ranking: Array<{ bidderId: BidderId; amount: Cents }>;
};
export type SettlementUpdateMsg = Ev & {
  t: 'settlement_update';
  rev: number;
  auctionState: SettlementState;
  you?: SettlementState;
  amountCaptured?: Cents;
  note?: string;
};
export type AuditEventMsg = Ev & { t: 'audit_event'; audit: AuditPayload };
export type ErrorMsg = Base & {
  t: 'error';
  code: ErrorCode;
  message: string;
  retryAfterMs?: number;
  seq?: number;
};

export interface RoomSnapshot {
  auctionId: AuctionId;
  config: PublicConfig;
  status: 'SCHEDULED' | 'OPEN' | 'PAUSED' | 'CLOSING' | 'SETTLING' | 'DONE';
  price: Cents | null;
  leaderId: BidderId | null;
  endTs: EpochMs;
  minNext: Cents;
  roster: Array<{ bidderId: BidderId; paddle: number; name: string; hold: 'HELD' | 'NONE' }>;
  recentAudit: AuditPayload[]; // max 50
  settlement?: { rev: number; auctionState: SettlementState; you?: SettlementState };
  you?: { bidderId: BidderId; ceiling: Cents }; // bidder role only
}
```

JSON examples (money in cents):

```json
{"v":1,"t":"join","token":"<opaque>","auctionId":"01J9ZQ4Y6Z8K3M5N7P9R1S3T5V","lastSeq":14}
{"v":1,"t":"bid","mid":"01J9ZQ5A0B2C4D6F8H0J2K4M6N","amount":35000,"source":"qr"}
{"v":1,"t":"bid","mid":"01J9ZQ5B0B2C4D6F8H0J2K4M6N","amount":35000,"source":"voice","transcript":"three fifty for twelve","confidence":0.62,"audioTsMs":1789000001200}
{"v":1,"t":"bid_accepted","seq":15,"ts":1789000001500,"mid":"01J9ZQ5A0B2C4D6F8H0J2K4M6N","bidId":"01J9ZQ5C0B2C4D6F8H0J2K4M6N","amount":35000}
{"v":1,"t":"price","seq":15,"ts":1789000001500,"price":35000,"leaderId":"01J9ZQ3A0B2C4D6F8H0J2K4M6N","leaderPaddle":12,"endTs":1789000060000,"minNext":36000,"extensions":0}
{"v":1,"t":"bid_rejected","seq":16,"ts":1789000002100,"mid":"01J9ZQ5D0B2C4D6F8H0J2K4M6N","reason":"over_ceiling","retryable":false}
{"v":1,"t":"confirm_request","seq":17,"ts":1789000003000,"confirmId":"01J9ZQ5E0B2C4D6F8H0J2K4M6N","amount":35000,"expiresAt":1789000018000}
{"v":1,"t":"hammer","seq":40,"ts":1789000062000,"winnerId":"01J9ZQ3A0B2C4D6F8H0J2K4M6N","price":52000,"ranking":[{"bidderId":"01J9ZQ3A0B2C4D6F8H0J2K4M6N","amount":52000}]}
{"v":1,"t":"settlement_update","seq":41,"ts":1789000063000,"rev":2,"auctionState":"CAPTURING","you":"CAPTURING"}
{"v":1,"t":"error","code":"rate_limited","message":"slow down","retryAfterMs":333}
```

### 4.2 Persisted event log (RoomEvent)

```ts
export type RoomEvent = { auctionId: AuctionId; seq: number; ts: EpochMs } & (
  | { type: 'auction_created'; config: AuctionConfig; auctioneerSub: string }
  | {
      type: 'bidder_registered';
      bidderId: BidderId;
      paddle: number;
      name: string;
      ceiling: Cents;
      holdRef: string;
    }
  | {
      type: 'bid_accepted';
      bidId: BidId;
      bidderId: BidderId;
      mid: MsgId;
      amount: Cents;
      source: BidSource;
      audit: AuditPayload;
      endTsAfter: EpochMs;
    }
  | {
      type: 'bid_rejected';
      bidderId: BidderId;
      mid: MsgId;
      amount?: Cents;
      reason: ErrorCode;
      audit: AuditPayload;
    }
  | {
      type: 'confirm_requested';
      confirmId: string;
      bidderId: BidderId;
      mid: MsgId;
      amount: Cents;
      expiresAt: EpochMs;
      audit: AuditPayload;
    }
  | {
      type: 'confirm_resolved';
      confirmId: string;
      outcome: 'accepted' | 'rejected' | 'expired' | 'superseded';
      audit: AuditPayload;
    }
  | {
      type: 'control';
      controlId: string;
      action: 'open' | 'pause' | 'resume' | 'extend' | 'hammer';
      by: string;
      args?: Record<string, number>;
      audit: AuditPayload;
    }
  | { type: 'state_changed'; from: string; to: string; endTs: EpochMs }
  | {
      type: 'hammered';
      winnerId: BidderId | null;
      price: Cents;
      ranking: Array<{ bidderId: BidderId; amount: Cents }>;
    }
  | { type: 'settle_requested' }
  | {
      type: 'settlement_update';
      rev: number;
      auctionState: SettlementState;
      perBidder: Record<string, SettlementState>;
      amountCaptured?: Cents;
      note?: string;
    }
);
```

### 4.3 Ports (packages/shared/src/ports.ts)

```ts
export interface RoomStore {
  appendEvents(auctionId: AuctionId, expectedSeq: number, events: RoomEvent[]): Promise<void>; // throws Conflict
  readEvents(auctionId: AuctionId, fromSeq: number, limit: number): Promise<RoomEvent[]>;
  lastSeq(auctionId: AuctionId): Promise<number>;
  saveSnapshot(auctionId: AuctionId, seq: number, state: unknown): Promise<void>;
  loadSnapshot(auctionId: AuctionId): Promise<{ seq: number; state: unknown } | null>;
  consumeJti(jti: Jti, ttlMs: number): Promise<boolean>; // true if first use
  denyJti(jti: Jti, untilMs: EpochMs): Promise<void>;
  isDenied(jti: Jti): Promise<boolean>;
  getJournal(key: string): Promise<{ version: number; value: unknown } | null>;
  putJournal(key: string, expectedVersion: number, value: unknown): Promise<void>; // throws Conflict
  listAuctions(): Promise<AuctionId[]>;
  ping(): Promise<void>;
}

export interface PaymentsPort {
  // implemented by packages/payments (proposed; confirm with owner)
  settle(req: {
    auctionId: AuctionId;
    outcome: HammerOutcome;
    holds: Record<BidderId, string>;
  }): Promise<void>; // idempotent by auctionId
  handleWebhook(req: {
    rawBody: Uint8Array;
    headers: Record<string, string>;
  }): Promise<
    | { kind: 'ok'; auctionId?: AuctionId }
    | { kind: 'duplicate' }
    | { kind: 'invalid_signature' }
    | { kind: 'retry'; reason: string }
  >;
  onSettlementUpdate(
    cb: (u: {
      auctionId: AuctionId;
      rev: number;
      auctionState: SettlementState;
      perBidder: Record<string, SettlementState>;
      amountCaptured?: Cents;
      note?: string;
    }) => void,
  ): () => void;
  onHoldReported(
    cb: (h: {
      auctionId: AuctionId;
      bidderId: BidderId;
      name: string;
      ceiling: Cents;
      holdRef: string;
    }) => void,
  ): () => void;
}

export interface EnginePort {
  register(bidder: string, ceiling: number): void;
  placeBid(
    bidder: string,
    amount: number,
    ts: number,
  ): { price: number | null; leader: string | null; endTs: number };
  tick(now: number): 'OPEN' | 'CLOSING' | 'SETTLING' | 'DONE';
  hammer(now: number): { winner: string | null; price: number; ranking: Array<[string, number]> };
  extendTo(endTs: number): void; // requested from the engine owner (pause/resume, auctioneer extend)
  complete(): void;
  view(): {
    state: string;
    price: number | null;
    leader: string | null;
    endTs: number;
    extensions: number;
    minNext: number;
    ranking: Array<[string, number]>;
  };
}

export interface Logger {
  debug(m: string, c?: object): void;
  info(m: string, c?: object): void;
  warn(m: string, c?: object): void;
  error(m: string, c?: object): void;
  child(c: object): Logger;
}
export interface TokenSigner {
  sign(claims: TokenClaims): Promise<string>;
  verify(token: string, expectKind?: TokenKind[]): Promise<TokenClaims>;
}
```

The existing engine (`packages/engine`, branch feat/engine-ts) has `register`, `placeBid`, `tick`, `hammer`, `complete` and codes `closed, unregistered, bad_amount, over_ceiling, below_reserve, below_increment, already_leading, not_open, bad_ceiling, not_higher_than_own_max, already_bid, cannot_hammer, cannot_complete`. It has no `extendTo`; that is a DEPS request. Without it, pause and resume (R-RT-049) cannot move `endTs`, and the fallback is to ship without pause (auctioneer `extend` also needs it).

### 4.4 Room core

```ts
export interface RoomDeps {
  store: RoomStore;
  clock: Clock;
  ids: Ids;
  engine: () => EnginePort;
  payments: PaymentsPort;
  log: Logger;
  limits: Limits;
  metrics: Metrics;
}
export class Room {
  static load(auctionId: AuctionId, deps: RoomDeps): Promise<Room>; // replays log (R-RT-059)
  submit(cmd: Command): Promise<CommandResult>; // enters the mailbox
  attach(conn: Connection, join: JoinMsg, claims: TokenClaims): Promise<void>;
  detach(conn: ConnId): void;
  status(): RoomStatus;
  close(): Promise<void>;
}
export type Command =
  | { k: 'bid'; by: Claims; msg: BidMsg; connId: ConnId }
  | { k: 'confirm'; by: Claims; msg: ConfirmResponseMsg }
  | {
      k: 'control';
      by: Claims;
      controlId: string;
      action: ControlAction;
      args?: Record<string, number>;
    }
  | { k: 'hold'; hold: HoldReport }
  | { k: 'settlement'; update: SettlementUpdate }
  | { k: 'timer'; which: 'close' | 'confirm_ttl' | 'auto_hammer'; ref?: string };
```

### 4.5 HTTP routes

| Method and path                            | Auth                                 | Purpose                                                           |
| ------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------- |
| POST /api/auctions                         | admin key                            | create auction, returns `{auctionId, auctioneerLink, screenLink}` |
| GET /api/auctions/:id                      | none                                 | public summary                                                    |
| POST /api/auctions/:id/invites             | auctioneer                           | mint 1..50 invites                                                |
| POST /api/auctions/:id/join                | invite token in body                 | exchange for session token `{sessionToken, bidderId, wsUrl}`      |
| POST /api/auctions/:id/control             | auctioneer                           | `{controlId, action, args}`                                       |
| POST /api/auctions/:id/auctioneer/rotate   | auctioneer                           | revoke and mint new link                                          |
| GET /api/auctions/:id/snapshot             | any role token                       | role-filtered RoomSnapshot                                        |
| GET /api/auctions/:id/events?after=&limit= | auctioneer, screen                   | wire-shaped frames                                                |
| GET /api/auctions/:id/export               | auctioneer or admin                  | NDJSON log                                                        |
| POST /webhooks/paypal                      | verifier only                        | raw body to PaymentsPort                                          |
| POST /api/demo/reset, /api/demo/seed       | admin key, DEMO_MODE                 | demo path                                                         |
| GET /healthz, /readyz, /metrics            | none (metrics: admin or private net) | ops                                                               |
| GET /ops/rooms                             | admin key                            | loaded rooms                                                      |
| GET /ws                                    | token in `join` frame                | WebSocket upgrade                                                 |

Authorization matrix (R-RT-085): operation x role.

| Operation               | auctioneer | bidder    | screen | admin |
| ----------------------- | ---------- | --------- | ------ | ----- |
| ws join                 | yes        | yes       | yes    | no    |
| bid (own)               | no         | yes       | no     | no    |
| bid (manual for others) | yes        | no        | no     | no    |
| confirm_response        | no         | yes (own) | no     | no    |
| control                 | yes        | no        | no     | no    |
| invites, rotate         | yes        | no        | no     | no    |
| snapshot (filtered)     | yes        | yes       | yes    | no    |
| export                  | yes        | no        | no     | yes   |
| create, demo, ops       | no         | no        | no     | yes   |

### 4.6 Close codes and error table (excerpt; full table in errors.ts)

| code                              | HTTP | WS close | retryable       |
| --------------------------------- | ---- | -------- | --------------- |
| bad_message                       | 400  | 1008     | no              |
| unsupported_version               | 400  | 4002     | no              |
| not_joined                        | 400  | 4003     | no              |
| unauthorized                      | 401  | 4401     | no              |
| forbidden                         | 403  | none     | no              |
| invite_used                       | 409  | none     | no              |
| rate_limited                      | 429  | none     | yes             |
| room_full, room_cap, auction_full | 503  | 4009     | yes (room_full) |
| store_unavailable                 | 503  | none     | yes             |
| conflict, host_fenced             | 409  | 4010     | no              |
| join timeout                      | n/a  | 4001     | n/a             |
| slow consumer                     | n/a  | 4008     | n/a             |
| process stop (SIGTERM)            | n/a  | 1001     | n/a             |

### 4.7 Config (env)

`PORT=8080`, `PUBLIC_URL`, `NODE_ENV`, `TOKEN_SECRET` (>= 32 bytes in production), `TOKEN_SECRET_PREVIOUS?`, `ADMIN_KEY` (>= 24 chars), `STORE=memory|postgres|d1`, `DATABASE_URL?`, `CORS_ORIGINS` (comma list), `LOG_LEVEL=info`, `DEMO_MODE=0`, `ALLOW_MEMORY_STORE=0`, `RATE_BID_PER_S=3`, `RATE_BID_BURST=5`, `MAX_CONN_PER_ROOM=500`, `MAX_BIDDERS_PER_ROOM=200`, `MAX_ROOMS=20`, `MAX_BIDS_PER_AUCTION=5000`, `PAYMENTS=fake|sandbox`. Payment credentials belong to packages/payments config and are never read here.

### 4.8 Token payload

```json
{
  "kind": "session",
  "aud": "01J9ZQ4Y6Z8K3M5N7P9R1S3T5V",
  "sub": "01J9ZQ3A0B2C4D6F8H0J2K4M6N",
  "bidderId": "01J9ZQ3A0B2C4D6F8H0J2K4M6N",
  "jti": "01J9ZQ6A0B2C4D6F8H0J2K4M6N",
  "iat": 1789000000,
  "exp": 1789014400
}
```

Lifetimes: invite 24 h, session 4 h, auctioneer 12 h, screen 12 h. Payload is base64url JSON, no `alg` field.

## 5. State machines and sequences

### 5.1 Room status

```
SCHEDULED --open--> OPEN --endTs/closeNow--> CLOSING --hammer--> SETTLING --SETTLED|FAILED_NEEDS_REVIEW--> DONE
              |  ^                               ^
            pause resume                         +-- soft close extends endTs while OPEN
              v  |
            PAUSED
```

Engine states OPEN, CLOSING, SETTLING, DONE map 1:1; SCHEDULED and PAUSED are room-level. Settlement states come from payments: HELD, BIDDING, WINNER_SELECTED, CAPTURING, CAPTURED, VOIDING, SETTLED, FALLBACK_RUNNER_UP, FAILED_NEEDS_REVIEW; RT stores and fans them out and gates DONE on SETTLED or FAILED_NEEDS_REVIEW.

### 5.2 Bid sequence

```
client        host/conn       Room mailbox           engine        store          others
  | bid(mid)      |               |                    |             |              |
  |-------------->| rate+schema   |                    |             |              |
  |               |--submit------>| dequeue: seq,ts    |             |              |
  |               |               |--placeBid--------->| validate    |              |
  |               |               |<--price/leader-----|             |              |
  |               |               |--appendEvents(expectedSeq)------>|              |
  |               |               |<--ok (or Conflict/failure: undo, error frame)--|  |
  |<--bid_accepted(seq)-----------|                    |             |              |
  |               |               |--price(seq)---------------------------------->| |
```

Failure branch: on append failure the engine mutation is discarded by rebuilding the engine from the in-memory event list, so state matches the log.

### 5.3 Confirmation

```
voice bid conf<0.85 -> confirm_requested(event) -> confirm_request(frame, TTL 15 s)
   accept -> pipeline at acceptance time -> bid_accepted | bid_rejected
   reject -> confirm_resolved(rejected)     TTL -> confirm_resolved(expired)   new voice bid -> superseded
```

### 5.4 Reconnect and resync

```
client(lastSeq=10) -- join --> host: verify token -> Room.attach
  room.lastSeq=14, gap 4 <= 200 and retained -> send frames 11..14 -> send state(seq=14)
  gap > 200 or not retained                   -> send state(seq=14)
client dedupes by seq; if it sees a seq gap it re-sends join with its lastSeq.
```

### 5.5 Hammer and settlement

```
CLOSING --hammer--> append hammered + settle_requested --> PaymentsPort.settle(auctionId) (once)
payments --onSettlementUpdate(rev n)--> mailbox -> drop if rev <= last -> append -> broadcast
SETTLED | FAILED_NEEDS_REVIEW --> status DONE
restart between hammered and settle call: settle_requested present, no settlement_update -> call settle again (idempotent by auctionId)
```

### 5.6 Host decision table (spike RT-86)

| Criterion                                             | Pass threshold for Durable Object to win                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Room p95 accept-to-broadcast, 20 clients, same region | within 1.5x of Node and < 150 ms                                                     |
| Restart recovery from log                             | < 2 s for 1000 events                                                                |
| Payments saga and secrets co-location                 | saga can run in same process or via authenticated call with no extra secret exposure |
| Persistence for ledger                                | D1 or SQLite-backed storage passes contract suite                                    |
| Deploy effort                                         | < 3 h from clean checkout to live URL, with existing wrangler login                  |
| Free-plan limits (WebSocket duration, requests)       | demo-sized load fits, UNVERIFIED (spike)                                             |

Any miss means Node. Default is Node on Render with Postgres (R-RT-142).

## 6. Error and edge cases

- Duplicate bid message (client retry on flaky link): same `mid`, same reply, one event.
- Bid at the same server millisecond as another: ordering is mailbox order, not client time; engine tie rules then apply to amounts.
- Bid after hammer or during SETTLING: `closed`.
- Bid over ceiling: `over_ceiling`, audited, never reaches payments.
- Auctioneer hammers twice (double click): second call returns the first outcome.
- Auctioneer token leaked: revoke via rotate; sockets with the old jti are closed with 4401.
- Two hosts started against one store (bad deploy): second append conflicts, loser stops (R-RT-061).
- Store down mid-auction: bids get `store_unavailable`; readyz fails; room recovers when the store returns without restart.
- Webhook arrives before `settle` returns or before the room is loaded: payments owns dedupe; room loads lazily from the log then ingests.
- Slow phone: bounded queue, closed 4008, resync on reconnect.
- Client clock wrong: ignored for ordering; `clientTs` only logged.
- Paused auction with active confirmation: confirmation TTL timers keep running; expiry is audited.
- Clock skew between Node instances: single host per room, so one clock decides.
- Large audit history: snapshots carry the last 50 rows only; the rest via `/events`.

## 7. Non-functional

- Latency: R-RT-150 targets. Measured in Actions, not on the 2-CPU VM.
- Determinism: R-RT-151; the room core takes Clock and Ids by injection; random scripts replay from a seed.
- Security: HMAC tokens, constant-time compare, strict schemas, Origin allowlist, size limits, no token in URLs or logs, ceilings never leave the owner, webhook body untouched for signature checks, admin key only on operator routes, no secrets in the repo (config names only in `.env.example`).
- Availability: single host per room by design; recovery by replay; demo restart safe.
- Observability: JSON logs with correlation ids, metrics JSON, `/ops/rooms`.
- Compatibility: wire changes bump `PROTOCOL_VERSION`; golden fixtures guard accidental drift.
- Accessibility: no UI here; error `message` strings are plain sentences suitable for screen readers.

## 8. Test specification

All tests run in GitHub Actions (Vitest; fast-check for property tests; Postgres as a service container; miniflare only if the Durable Object path is taken). Tests use `ManualClock`, `SeqIds`, `MemoryStore`, `StubPayments` and the scripted-client harness (RT-42); nothing touches the network or PayPal. Kinds: unit, property, fault (injected failure), race, integration, contract, performance, scenario, spike.

- **T-RT-001** [unit] (R-RT-001) parseId accepts `01HZX3K9Q8W2M4N6P8R0S2T4V6`; rejects length 25/27, char `U`, `I`, lowercase-invalid, prefix above 7ZZZZZZZZZ
- **T-RT-002** [property] (R-RT-002) mint 10_000 ids with a frozen Clock: strictly increasing, unique, sorted == minted order
- **T-RT-003** [unit] (R-RT-003) SeqIds yields `..0001`, `..0002` deterministically and implements Ids
- **T-RT-004** [unit] (R-RT-004) Cents(35000) ok; Cents(1.5), Cents(-1), Cents(NaN), Cents(1e12) throw bad_amount
- **T-RT-005** [property] (R-RT-005) for n in 0..99_999_999_999 sampled: parseUsd(formatUsd(n)) == n; parseUsd('1.234') throws; '$1,250' == 125000
- **T-RT-006** [property] (R-RT-006) add/sub/min/max agree with BigInt reference; overflow and negative sub throw
- **T-RT-007** [unit] (R-RT-007, R-RT-008) ManualClock with timers at 10,10,5: fire order 5,10(first),10(second); cancel prevents firing; now()==due inside callback
- **T-RT-008** [unit] (R-RT-009) every ErrorCode has status/closeCode/retryable; table has no duplicates; snapshot test of the table
- **T-RT-009** [unit] (R-RT-010) ApiError rejects extra fields; message scrubber removes `Bearer ...` and 32+ char token-like strings
- **T-RT-010** [unit] (R-RT-011) valid config parses; strict rejects unknown key; mode default english; currency EUR rejected
- **T-RT-011** [unit] (R-RT-012) boundary table: reserve 99 fail/100 ok; increment 0 fail/1 ok; extension 600000 ok/600001 fail; maxExtensions 50 ok/51 fail; presets unsorted fail, 9 entries fail, preset < reserve fail
- **T-RT-012** [unit] (R-RT-013) SettlementState has exactly the 9 names in order
- **T-RT-013** [unit] (R-RT-014, R-RT-023) unknown t, extra field, v:2, 16385-byte frame each yield bad_message (v:2 yields unsupported_version at join)
- **T-RT-014** [unit] (R-RT-015) valid join/bid/confirm_response parse; a server-only type sent by client rejected
- **T-RT-015** [unit] (R-RT-016) each of the 10 server messages parses from its golden fixture
- **T-RT-016** [unit] (R-RT-017) server frames without seq rejected except error; seq must be positive integer
- **T-RT-017** [property] (R-RT-018) fast-check: decodeMsg never throws for arbitrary strings, bytes, deep JSON (depth 10_000), huge numbers
- **T-RT-018** [unit] (R-RT-019) audit_event requires bidId, bidderId, source, outcome; amount fields optional only for non-bid actions; confidence in [0,1]
- **T-RT-019** [unit] (R-RT-020) RoomEvent fixtures per type parse; gap in seq detected by `assertGapless`
- **T-RT-020** [unit] (R-RT-021) every file in fixtures/ decodes then encodes byte-identically
- **T-RT-021** [unit] (R-RT-022) lint check: ports.ts exports only types/interfaces (ts-morph or tsc declaration check)
- **T-RT-022** [property] (R-RT-030, R-RT-031) N=50 concurrent submitted commands to one room: handler never re-entered (instrumented counter max 1), seq gapless
- **T-RT-023** [unit] (R-RT-031) ManualClock at 1000 then command with client ts 5: event.serverTs == 1000; ordering unaffected by client ts
- **T-RT-024** [unit] (R-RT-032) store spy records append before any transport send for the same seq in 100 random bid runs
- **T-RT-025** [fault] (R-RT-033) FlakyStore fails 1st append: sender gets error store_unavailable, state and seq unchanged, no frames to others; next bid succeeds with seq unchanged+1
- **T-RT-026** [unit] (R-RT-034) send same mid twice, and again after restart from log: second reply identical, event count unchanged
- **T-RT-027** [unit] (R-RT-035) table of rejections: unregistered, below_increment, over_ceiling, below_reserve, closed, already_leading, bad_amount, paused each map to the same code string
- **T-RT-028** [unit] (R-RT-036) bid 35000 by B1: B1 gets bid_accepted seq=n, all 3 connections get price seq=n with price=35000, leaderId=B1, minNext=35000+inc
- **T-RT-029** [unit] (R-RT-037) rejected bid goes only to sender; other connections receive nothing
- **T-RT-030** [unit] (R-RT-038, R-RT-040) one accepted, one rejected, one confirm expiry, one control: 4 audit_events persisted with correct outcome
- **T-RT-031** [unit] (R-RT-039, R-RT-040) bid frame with spoofed bidderId by a bidder is ignored; manual bid by auctioneer with bidderId works and audit carries auctioneer sub
- **T-RT-032** [unit] (R-RT-041) endTs=10_000, advance to 10_000: state frame CLOSING broadcast once; later bid rejected closed
- **T-RT-033** [unit] (R-RT-041, R-RT-042) softWindow 5000 ext 10000: bid at 8000 moves endTs to 18000 in same price frame; timer re-armed; maxExtensions=2 stops third
- **T-RT-034** [unit] (R-RT-043) bid at endTs-1 accepted; at endTs rejected closed; with soft close, bid at endTs-1 extends
- **T-RT-035** [unit] (R-RT-044) autoHammerDelayMs=3000: hammer fires at CLOSING+3000; skipped if auctioneer hammered at +1000
- **T-RT-036** [unit] (R-RT-045) voice bid conf 0.62 -> confirm_request to bidder only; engine bid list empty; conf 0.85 -> no confirm; ambiguous flag with 0.99 -> confirm
- **T-RT-037** [unit] (R-RT-046) accept after 4 s: bid placed with serverTs of acceptance; reject: audit rejected, no bid; no response 15 s: audit expired
- **T-RT-038** [unit] (R-RT-047) two low-confidence voice bids: first marked superseded, only second pending
- **T-RT-039** [unit] (R-RT-048, R-RT-085) each of open/pause/resume/extend/hammer: bidder token 403, screen 403, auctioneer 200; replay with same controlId returns first result
- **T-RT-040** [unit] (R-RT-049) pause at 5000 with endTs 10000, bid -> auction_paused; resume at 9000 -> endTs 14000; timer re-armed
- **T-RT-041** [unit] (R-RT-050) hammer in CLOSING broadcasts one hammer; second call same body and no new event; closeNow in OPEN works
- **T-RT-042** [fault] (R-RT-051, R-RT-060) crash after hammered event appended before settle call: restart calls settle once; calling twice in normal flow yields one settle call
- **T-RT-043** [unit] (R-RT-052) updates rev 1,3,2 delivered in that order: rev 2 dropped as stale, 1 and 3 persisted and broadcast; non-winner frame hides winner's state
- **T-RT-044** [unit] (R-RT-053) room status DONE only after SETTLED or FAILED_NEEDS_REVIEW; CAPTURED alone leaves SETTLING
- **T-RT-045** [unit] (R-RT-054, R-RT-055) payments reports hold: registered with ceiling to bidder, roster delta without ceiling to others
- **T-RT-046** [property] (R-RT-055, R-RT-086) across 200 random sessions, no frame to a non-owner or screen contains the substring of any ceiling value field `ceiling`
- **T-RT-047** [unit] (R-RT-056) state snapshot for bidder vs screen vs auctioneer matches golden; last 50 audit rows max
- **T-RT-048** [unit] (R-RT-057) client at seq 10, room at 14: receives frames 11..14 then state; gap 201: state only
- **T-RT-049** [unit] (R-RT-058) 4th connection with same token closes the oldest with superseded
- **T-RT-050** [property] (R-RT-059, R-RT-095, R-RT-151) random bid/control/extend script: state after live run == state after rebuild from log (deep equal); also with and without snapshot
- **T-RT-051** [unit] (R-RT-060) restart mid-OPEN re-arms close at endTs; restart in SETTLING resumes settle
- **T-RT-052** [fault] (R-RT-061) two RoomHost instances on one store: second append gets conflict, loser stops serving and emits host_fenced
- **T-RT-053** [unit] (R-RT-062) DONE room idle 15 min with 0 connections evicted; reload from log works; 21st room refused room_cap
- **T-RT-054** [unit] (R-RT-070, R-RT-072) MemoryTransport delivers frames in order and supports close codes
- **T-RT-055** [fault] (R-RT-071) client never drains: after 256 queued frames connection closed 4008, other clients unaffected, reconnect resyncs
- **T-RT-056** [unit] (R-RT-073) no join within 5 s -> close 4001; frame before join -> error not_joined; pings every 20 s, 2 misses drop
- **T-RT-057** [integration] (R-RT-074) ws with bad Origin refused 403; payload 16385 bytes closes 1009; plain GET /ws returns 426
- **T-RT-058** [unit] (R-RT-080, R-RT-081) sign/verify round trip; flip one bit of payload or sig fails; alg-none style header rejected; compare is constant time (uses timingSafeEqual or XOR loop)
- **T-RT-059** [unit] (R-RT-081) wrong aud, expired (exp=now-1), wrong kind for route each rejected with auth error codes
- **T-RT-060** [unit] (R-RT-082) token signed with previous secret verifies; new tokens signed with current only
- **T-RT-061** [unit] (R-RT-083) exchange invite twice concurrently: exactly one succeeds, other invite_used
- **T-RT-062** [unit] (R-RT-084) revoked auctioneer jti rejected on HTTP and WS; rotate returns new working link, old one dead
- **T-RT-063** [property] (R-RT-080) random byte strings and mutated valid tokens never verify and never throw
- **T-RT-064** [unit] (R-RT-086) screen token bid/control rejected forbidden; frames contain no ceiling
- **T-RT-065** [contract] (R-RT-090, R-RT-091) append gapless, stale expectedSeq conflict, readEvents ranges, snapshot save/load, consumeJti atomic, journal version check, ping
- **T-RT-066** [unit] (R-RT-092) MemoryStore passes the contract suite
- **T-RT-067** [integration] (R-RT-093) Postgres adapter passes the contract suite in Actions service container; 20 parallel appends to one seq: one wins
- **T-RT-068** [integration] (R-RT-094) D1 adapter (miniflare or local SQLite) passes the contract suite
- **T-RT-069** [unit] (R-RT-095) snapshot saved at events 100 and 200 and at state change; delete snapshot, recovery still equal
- **T-RT-070** [integration] (R-RT-096) fresh DB migrates; second run is no-op; two concurrent boots apply once
- **T-RT-071** [unit] (R-RT-097) adapter exposes no update/delete; export streams seq 1..n in order
- **T-RT-072** [unit] (R-RT-100) each ErrorCode surfaces with the right status and x-request-id; unknown route 404 with {code,message}
- **T-RT-073** [integration] (R-RT-101) admin key creates auction; missing key 401; invalid config 400 with field paths; response has links, no secrets beyond tokens
- **T-RT-074** [integration] (R-RT-102) GET summary is public and lists no ceilings or tokens
- **T-RT-075** [integration] (R-RT-103) auctioneer mints invite; join returns session token; bidder token cannot mint invites (403)
- **T-RT-076** [integration] (R-RT-104) snapshot and events?after=5&limit=10 return schema-valid role-filtered data
- **T-RT-077** [integration] (R-RT-105) 415 for text/plain, 413 for 65537 bytes, CORS preflight allowed only for allowlist
- **T-RT-078** [integration] (R-RT-106) control hammer over HTTP then WS client receives hammer frame
- **T-RT-079** [integration] (R-RT-107) DEMO_MODE=0: /api/demo/\* 404; =1 reset gives empty room, seed gives scripted auction with 3 bidders
- **T-RT-080** [unit] (R-RT-108) export NDJSON equals log; ReplayFeed at 4x with ManualClock emits frames at original deltas / 4
- **T-RT-081** [unit] (R-RT-110) byte-exact raw body (including odd whitespace) reaches PaymentsPort; JSON is not re-serialised
- **T-RT-082** [unit] (R-RT-111) stub returns ok, duplicate, invalid_signature, retry: 200,200,400,503
- **T-RT-083** [unit] (R-RT-112) 256 KiB+1 body 413; logs contain event id and outcome, not the body
- **T-RT-084** [unit] (R-RT-113) handleWebhook stalls 2 s: bids in the room still accepted within 50 ms; its resulting update appears via mailbox with next seq
- **T-RT-085** [unit] (R-RT-114) unknown auctionId in event: 200 and warn log
- **T-RT-086** [unit] (R-RT-120, R-RT-122) 6 bids in 100 ms by one bidder: 5 processed, 6th rate_limited with retryAfterMs>0, event count unchanged; other bidder unaffected; refill after 333 ms
- **T-RT-087** [unit] (R-RT-120) frames 41 in 1 s per connection limited; 11 joins/min per IP limited; webhook route exempt
- **T-RT-088** [unit] (R-RT-121, R-RT-122) 501st connection room_full; 4th conn per bidder superseded; 201st bidder room_full; 5001st bid rejected auction_full; counters increment
- **T-RT-089** [unit] (R-RT-130) bad env lists every error and exit code 1; secrets redacted in dump
- **T-RT-090** [unit] (R-RT-131) production with 16-byte secret fails; memory store without override fails; with override passes
- **T-RT-091** [unit] (R-RT-132) token, secret, Authorization keys and token-shaped strings redacted in nested objects
- **T-RT-092** [unit] (R-RT-133) bid handling logs include reqId/connId/auctionId/seq
- **T-RT-093** [integration] (R-RT-134) healthz 200 always; readyz 503 until migrations applied and store pings, 503 again if store fails
- **T-RT-094** [integration] (R-RT-135) after N bids /metrics counters equal N and histograms populated
- **T-RT-095** [integration] (R-RT-136) SIGTERM: new connections refused, open sockets closed 1001, process exits < 10 s with mailboxes drained
- **T-RT-096** [integration] (R-RT-137) /ops/rooms requires admin key and lists rooms
- **T-RT-097** [unit] (R-RT-140, R-RT-151) lint: packages/shared and room core import no `node:*` and no Date.now/Math.random
- **T-RT-098** [spike] (R-RT-141, R-RT-142) benchmark harness run on both hosts, results table committed to docs/DECISIONS.md with decision and date
- **T-RT-099** [integration] (R-RT-143) if chosen: room core runs in a Durable Object under miniflare, passes the scenario fixtures
- **T-RT-100** [performance] (R-RT-150) MemoryStore: p95 accept-to-last-broadcast < 50 ms over 5000 bids; Postgres localhost < 150 ms; 500-bid snapshot < 200 ms
- **T-RT-101** [performance] (R-RT-152) 100 bidders, 10 bids/s, 60 s: zero seq inversions, mailbox depth max <= 50
- **T-RT-102** [performance] (R-RT-153) 5000-event log recovers < 2 s and heap < 20 MB
- **T-RT-103** [scenario] (R-RT-031, R-RT-036, R-RT-050, R-RT-052, R-RT-053) fixture happy-path-english: 3 bidders, 7 bids, hammer, settlement SETTLED; expected frame transcript matches golden
- **T-RT-104** [scenario] (R-RT-030, R-RT-031) fixture same-ms-tie: two bids same server ms resolved by arrival seq; golden transcript
- **T-RT-105** [scenario] (R-RT-057, R-RT-059) fixture reconnect-mid-auction: client drops at seq 5, rejoins with lastSeq 5, final view equals peers
- **T-RT-106** [race] (R-RT-030, R-RT-043, R-RT-050) bid and hammer submitted in same tick: either bid precedes hammer and is in outcome, or follows and gets closed; never half-applied; 1000 random interleavings
- **T-RT-107** [race] (R-RT-030, R-RT-052, R-RT-113) bid during SETTLING rejected closed; webhook update and bid interleaved keep seq gapless
- **T-RT-108** [unit] (R-RT-035) EngineAdapter drives @gavel/engine through EnginePort; every engine Rejected code maps to a wire reason; view() matches engine state after 100 random ops
- **T-RT-109** [unit] (R-RT-051, R-RT-111) StubPayments records settle calls and handleWebhook inputs, can inject ok/duplicate/invalid_signature/retry and push settlement updates
- **T-RT-110** [unit] (R-RT-033, R-RT-061) FlakyStore fails the Nth append, delays, or returns conflict on demand and otherwise delegates

## 9. Fixtures and harness

- `packages/shared/fixtures/wire/<message>.json` and `fixtures/events/<type>.json`: one golden file per message and record (RT-20). The web package imports them for contract tests.
- `packages/server/test/scenarios/*.json`: scripted scenarios, format:

```json
{
  "name": "happy-path-english",
  "config": { "reserve": 10000, "minIncrement": 1000, "endTs": 60000 },
  "clients": {
    "A": { "role": "bidder", "paddle": 12, "ceiling": 50000 },
    "B": { "role": "bidder", "paddle": 7, "ceiling": 30000 },
    "HOST": { "role": "auctioneer" }
  },
  "steps": [
    {
      "at": 1000,
      "from": "A",
      "send": { "t": "bid", "mid": "m1", "amount": 10000, "source": "qr" }
    },
    {
      "at": 2000,
      "from": "B",
      "send": { "t": "bid", "mid": "m2", "amount": 12000, "source": "qr" }
    },
    { "at": 60000, "from": "HOST", "control": "hammer" },
    { "at": 61000, "settlement": { "rev": 1, "auctionState": "SETTLED" } }
  ],
  "expect": { "framesFile": "happy-path-english.frames.json", "finalStatus": "DONE", "winner": "A" }
}
```

The same runner is imported by packages/e2e so UI scenarios and server scenarios share fixtures.

- Test seeds: property tests print the fast-check seed on failure; `RT_SEED` pins it.
- Fault injection: `FlakyStore` (fail Nth append, delay, force Conflict), `StubPayments` (inject ok, duplicate, invalid_signature, retry; push out-of-order updates), slow-consumer client that never drains.

## 10. Open questions

| #   | Question                                                                     | Decision owner                         | Default                                                          |
| --- | ---------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| 1   | Durable Object or Node host?                                                 | Project owner with spike RT-86 results | Node on Render plus Postgres (R-RT-142)                          |
| 2   | Engine gains `extendTo(endTs)` for pause/resume and auctioneer extend        | engine owner                           | Add it; if refused, drop pause and extend from the demo          |
| 3   | PaymentsPort shape (`settle`, `handleWebhook`, update callbacks) acceptable? | payments owner                         | As in 4.3; adapter layer in server if payments differs           |
| 4   | Can an auctioneer void an accepted bid (misheard)? Breaks log purity         | Project owner                          | No; use a manual counter-bid and an audit note                   |
| 5   | Does PayPal retry non-2xx webhooks and on what schedule?                     | payments owner, gate G4                | UNVERIFIED (G4); route returns 503 for `retry`, 200 otherwise    |
| 6   | Who confirms low-confidence voice bids: bidder only or auctioneer too?       | web owner                              | Bidder only (R-RT-045)                                           |
| 7   | Is `confirmConfidenceThreshold` 0.85 right?                                  | voice owner after gate G5              | 0.85, configurable per auction                                   |
| 8   | Hosted store for the live demo: Render Postgres free tier lifetime limits    | Project owner                          | Use it for the judging window; MemoryStore plus export as backup |
| 9   | Should the screen role see bidder names or paddles only?                     | web owner                              | Paddles and first names                                          |
| 10  | Room events retention beyond the hackathon                                   | Project owner                          | Keep forever, sandbox data only                                  |
