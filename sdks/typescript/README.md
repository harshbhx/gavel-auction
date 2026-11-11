# GAVEL host API

[![Built with APIMatic][apimatic-badge]][apimatic-url] [![License: MIT][license-badge]][license-url]

The GAVEL host API SDK for TypeScript provides typed access to the GAVEL host API REST APIs from Node.js and the browser.

> [!TIP]
> **Looking for a specific signature, request field, model, enum or error type?** This SDK ships a generated, machine-readable **[SDK map](sdk-map.md)** — a lookup index of the whole TypeScript surface. Consult it **before** grepping or scanning the source tree; it answers most contract questions directly and, where a source file is genuinely needed, names the exact one to open. Details under [SDK map](#sdk-map).

GAVEL is an auction where every bid is backed by a PayPal hold and only the winner pays.
This document describes the public HTTP API of the host (`packages/server`). It is written
by hand from the route files in `packages/server/src/http/` and the schemas in
`packages/shared/src/`, and a test (`scripts/tests/openapi-routes.test.mjs`) fails when a
route in the code is missing here or a path here has no route in the code.

**Sandbox only.** The host talks to the PayPal sandbox. No real money moves.

## Authentication

Several kinds of credential exist. None of them is a real value in this document.

| Credential | How it is sent | Who gets it |
| --- | --- | --- |
| Operator key | header `X-Admin-Key` | the operator who runs the host (environment setting `ADMIN_KEY`) |
| Auctioneer token | `Authorization: Bearer <token>`, valid 12 hours | returned as a link when an auction is created or rotated |
| Screen token | `Authorization: Bearer <token>`, valid 12 hours | returned as a link when an auction is created |
| Session (bidder) token | `Authorization: Bearer <token>`, valid 4 hours | returned by the join routes |
| Receipt token | `Authorization: Bearer <token>`, valid 4 hours | returned by the receipt-link route |
| Reviewer token | `Authorization: Bearer <token>`, valid 12 hours | returned as `reviewerToken` and `reviewerLink` when a judge room is created; read only, a screen's view plus the room ledger |
| Judge key | header `X-Judge-Key` | a limited key for judges, `gvl_judge_<id>_<secret>` (per-judge entries in `JUDGE_KEYS`, or the shared `JUDGE_KEY`; never the operator key); optional, only on the judge-room create and key-check routes |
| Invite token | field `invite` in the body of the join route, valid 24 hours, single use | minted by the auctioneer |

Every token is bound to one auction (its `aud`) and to one kind. A token of the wrong kind
or for another auction answers 401. A token whose role may not do the thing answers 403.
Tokens are opaque strings: do not parse them. A reviewer token can read the snapshot, the
event log and the room ledger of its own judge room, and nothing else. Judge rooms need no
key; the judge key only lifts the public limits when a host has one set (see
`POST /api/judge/key`). The judge key is sent only in the `X-Judge-Key` header, never in a
URL or body.

Links the host returns carry the token in the URL fragment (`#token=`) so it never reaches
a server log.

## Errors

Every error is JSON. The fields vary slightly by route family because the host grew in
layers; read them like this and you are safe on every route:

- `message`: text for a person. Always present on `/api/**` errors.
- `code`: the stable error code (see `ErrorCode`). Present on the core routes (auctions,
  control, invites, read, receipts, auctioneer tokens) and on judge routes.
- `error`: the same stable code on the hold routes, the judge routes and the operator
  routes. Judge routes also send `code`. Operator routes send only `error`.
- `detail`: optional extra text, for example the field paths that failed validation.

A client should read `code ?? error`. See the `Error` schema.

Messages never contain tokens or stack traces (they are scrubbed on the server).

Status codes in use: 400 bad request, 401 missing or bad credential, 403 not allowed,
404 not found, 409 conflict, 410 gone (a judge room that ended), 413 body over 64 KiB,
415 body is not `application/json`, 429 rate limited, 500 internal, 503 unavailable.

## Rate limits

Limits are published as the vendor extension `x-rate-limit` on the operations they apply
to, and as `x-rate-limits` at the top of this document for the host-wide defaults. A 429
always carries a `Retry-After` header in seconds. The numbers are the defaults and can be
changed by the operator through environment settings.

## Request ids and CORS

Send `X-Request-Id` (1 to 64 characters of `A-Z a-z 0-9 _ -`) to correlate a request;
every response carries `X-Request-Id`, and the server mints one when you send none or an
invalid one. Browsers are allowed only from the origins the operator lists; other origins
get no CORS headers. Allowed request headers are `Authorization`, `Content-Type`,
`X-Request-Id`, `X-Admin-Key` and `X-Judge-Key`; readable response headers are
`X-Request-Id` and `Retry-After` (also on early 429, 404 and 500 answers).

## Not in this document

- **WebSocket protocol.** Live bidding runs on `wss://<host>/ws` and OpenAPI cannot model
  it. See the section "WebSocket protocol" below and
  https://github.com/harshbhx/gavel-auction/blob/main/docs/API.md.
- **PayPal webhook.** `POST /webhooks/paypal` is called by PayPal only, is verified by
  PayPal's signature, and is not part of the client API.
- **Demo routes.** `/api/demo/reset`, `/api/demo/seed` and `/api/demo/rooms` exist only
  when the host runs with `DEMO_MODE=1` on the fake payments adapter and never in a
  production-like configuration. They answer 404 otherwise.

## WebSocket protocol

Endpoint: `wss://<host>/ws`. The browser must send an `Origin` that the operator allows;
a request without one is refused. A plain HTTP request to `/ws` answers 426. Frames are
JSON text, at most 16 KiB from the client (a larger or binary frame closes the socket) and
at most 256 KiB from the server. Every frame is `{"v":1,"t":"<type>", ...}`; an unknown
type, extra field or wrong version is `bad_message` (a `join` with another version is
`unsupported_version`).

Client to server, the only three types accepted:

| `t` | Purpose | Fields |
| --- | --- | --- |
| `join` | First frame. Opens the session. | `token` (session, auctioneer, screen or reviewer token; a reviewer joins with a screen's view), `auctionId`, optional `lastSeq` (resume after this sequence number), optional `client` ({name, version}) |
| `bid` | Place a bid. | `mid` (id you mint, for idempotency), `amount` (cents), `source` (`voice`, `qr` or `manual`), optional `bidderId`, `transcript`, `confidence`, `ambiguous`, `audioTsMs`, `audioEndMs`, `clientTs` |
| `confirm_response` | Answer a spoken-bid confirmation. | `confirmId`, `accept` |

Server to client:

| `t` | Purpose |
| --- | --- |
| `registered` | Your bidder id, paddle and role after `join`. |
| `state` | Full room snapshot (same shape as `RoomSnapshot`), sent after `join` and when resyncing. |
| `price` | New price, leader, end time and next minimum. |
| `bid_accepted` / `bid_rejected` | Result of your `bid` (match on `mid`); a rejection carries `reason` (an `ErrorCode`), `retryable` and optional `retryAfterMs`. |
| `confirm_request` | A spoken bid needs the bidder's yes or no. |
| `hammer` | Lot ended: winner, price, ranking. |
| `settlement_update` | Settlement progress (holds captured or released). |
| `audit_event` | One audit row, filtered by role. |
| `error` | `code`, `message`, optional `retryAfterMs`; may close the socket. |

Socket close codes follow `ErrorCode`: 1008 bad message, 4002 unsupported version,
4003 not joined, 4401 unauthorized, 4009 room or auction full, 4010 conflict or host
fenced, 4429 rate limited (frame flood), 1011 internal. Limits: bids 3 per second (burst
5), frames 20 per second (burst 40), at most 20 open sockets per source address.

The full protocol, with every field, is in the repository file
`docs/specs/realtime/SPEC-realtime.md` and on the docs site page "WebSocket protocol".


---

## Installation

The SDK compiles to `dist/` before it can be referenced — run its `build` script once in the SDK folder, then add it to your project by path:

```bash
npm install <path-to-sdk>
```

---

## Quick Start

Create one client and reuse it. Configure its behaviour through [ClientOptions](src/client-options.ts).

```ts
import { GavelHostApiClient, ServerEnvironment } from "gavel-sdk";

const client = new GavelHostApiClient({
  serverEnvironment: ServerEnvironment.Production,
  adminKey: "YOUR_API_KEY",
  auctioneerAuth: "YOUR_BEARER_TOKEN",
  screenAuth: "YOUR_BEARER_TOKEN",
  reviewerAuth: "YOUR_BEARER_TOKEN",
  judgeKey: "YOUR_API_KEY",
  sessionAuth: "YOUR_BEARER_TOKEN",
  receiptAuth: "YOUR_BEARER_TOKEN",
});
```

Nothing in `ClientOptions` is required — `new GavelHostApiClient()` compiles — and each option left out falls back to its default. `serverEnvironment` is spelled out above so the environment a call reaches is visible where the client is built rather than inherited silently.

### From CommonJS

The package ships both dialects from a single entry, so `require` works with full types. In a TypeScript CommonJS file use the `import ... = require(...)` form — a plain destructuring `require` runs fine but gives you `any`.

```ts
import sdk = require("gavel-sdk");

const client = new sdk.GavelHostApiClient({
  serverEnvironment: sdk.ServerEnvironment.Production,
  adminKey: "YOUR_API_KEY",
  auctioneerAuth: "YOUR_BEARER_TOKEN",
  screenAuth: "YOUR_BEARER_TOKEN",
  reviewerAuth: "YOUR_BEARER_TOKEN",
  judgeKey: "YOUR_API_KEY",
  sessionAuth: "YOUR_BEARER_TOKEN",
  receiptAuth: "YOUR_BEARER_TOKEN",
});
```

---

## Usage

For code examples and error responses, see [API Reference](api-reference.md).

---

## SDK map

This SDK ships a generated **SDK map** — [`sdk-map.md`](sdk-map.md) plus the pages under [`map/operations/`](map/operations/auctions.md) — a deterministic, lookup-oriented table of contents of the TypeScript surface, generated alongside the SDK.

**Read it before scanning the source.** Whether you are an AI coding assistant or searching by hand, the map answers "what is the exact …" by lookup for every call-level contract, and for anything it does not carry it names the one file that does:

- **[`sdk-map.md`](sdk-map.md)** — the index: client construction, the one error family, the non-throwing `.asApiResult()` form, servers, environments and auth, the model locator, the runtime facts, and the SDK-wide defaults every operation relies on.
- **[`map/operations/`](map/operations/auctions.md)** — one page per resource: the exact signature and return type, the verb and route, the request body and its media type, a **Fields** table giving every request field its channel, and a **Type sources** table naming the file and schema value of every type the operation mentions.

Model shapes — object properties with their wire names, enum member names and wire values, union variants — are **not** duplicated in the map, and not in the API reference either. Both name the type and the file to read; take the pair from the operation's **Type sources** table and read the declaring file. That file is the single source of truth and cannot go stale against the code.

**Each operation block states only what is specific to it.** The SDK-wide defaults are stated once in [`sdk-map.md`](sdk-map.md) — the call shape, the base `ApiError`, the default server group — and a block departs from one only by saying so, so a block silent on a point is telling you the default applies. Take it and move on rather than opening the source to confirm.

### Which one to reach for

The map and the [API reference](api-reference.md) answer different questions, and both are generated from this SDK so they stay in lockstep with the code.

| Use | For |
| --- | --- |
| **[`sdk-map.md`](sdk-map.md) + [`map/operations/`](map/operations/auctions.md)** | Traversing the SDK and working out its surface — locating the operation you need (this SDK exposes **47 operations**), its exact signature, which credential it sends, which channel every request field travels on, which error type it rejects with and how to read it, and the file behind any type. This is the index to consume the SDK from, and the one to reach for first. |
| **[`api-reference.md`](api-reference.md)** | Usage guidance for a single operation once you know which one you want — a code sample for each of the two call forms (awaiting it, and the non-throwing `.asApiResult()`), per-parameter descriptions, and the success and error types it resolves or rejects with. |

---

## License

This SDK is distributed under the [MIT License](LICENSE).

---

## Support

Refer to the [API reference](api-reference.md) for detailed information on available operations with code samples.

---

[license-url]: LICENSE
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg
[apimatic-url]: https://www.apimatic.io
[apimatic-badge]: https://www.apimatic.io/hubfs/Built-with-APIMatic-badge.svg
