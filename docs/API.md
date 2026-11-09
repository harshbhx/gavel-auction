# API reference

The GAVEL host exposes a small HTTP API and one WebSocket. The HTTP API is described by an
OpenAPI 3.1 document:

- Source of truth: [`openapi/gavel.yaml`](../openapi/gavel.yaml)
- Served from the docs site: https://docs.gavel.dualmindlab.tech/openapi.yaml
- Docs site page: https://docs.gavel.dualmindlab.tech/docs/reference/api-reference

PayPal sandbox only: no real money moves through any route here.

## How the document stays correct

The document is written by hand from the route files in `packages/server/src/http/` and the
schemas in `packages/shared/src/`. Two checks in CI keep it honest:

- `openapi` job in `.github/workflows/ci.yml` lints it with Redocly CLI (`openapi/redocly.yaml`),
  including a check that every example matches its schema.
- `scripts/tests/openapi-routes.test.mjs` reads the server source and fails when a route in the
  code has no entry in the document, or an entry has no route. Routes left out on purpose are
  listed in that test with the reason: the PayPal webhook (called by PayPal only) and the three
  demo routes (`DEMO_MODE` only, never in production).

If you add a route, add it to `openapi/gavel.yaml` in the same change.

## What is covered

| Area           | Routes                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Auctions       | `POST /api/auctions`, `GET /api/auctions/{id}` (id or join code), auctioneer token rotate and revoke |
| Control        | `POST /api/auctions/{id}/control`, `POST /api/auctions/{id}/kill`                                    |
| Bidding access | invites, re-issue an invite, `POST /api/auctions/{id}/join`                                          |
| Read           | `GET /api/auctions/{id}/snapshot`, `GET /api/auctions/{id}/events`                                   |
| Holds          | `POST /api/holds`, approve, read, abandon                                                            |
| Judge rooms    | capabilities, create, join, simulated hold, key check, room ledger, pause switch                     |
| Receipts       | receipt link, receipt                                                                                |
| Export         | `GET /api/auctions/{id}/export` (NDJSON), `GET /admin/export`, `GET /admin/replay-bundle`            |
| Health         | `/healthz`, `/readyz`, `/version`, `/warmup`                                                         |
| Operator       | `/metrics`, `/metrics/prometheus`, `/ops/summary`, `/ops/rooms`, void-all, release-review            |

The metrics and ops routes need the operator key; they are listed so an operator can find
them, not because they are public.

## Authentication

| Credential       | Sent as                               | Lifetime             | Where it comes from                                                  |
| ---------------- | ------------------------------------- | -------------------- | -------------------------------------------------------------------- |
| Operator key     | header `X-Admin-Key`                  | n/a                  | the host setting `ADMIN_KEY`                                         |
| Auctioneer token | `Authorization: Bearer ...`           | 12 hours             | auction creation, judge-room creation, rotate                        |
| Screen token     | `Authorization: Bearer ...`           | 12 hours             | auction creation, judge-room creation                                |
| Session token    | `Authorization: Bearer ...`           | 4 hours              | the join routes                                                      |
| Receipt token    | `Authorization: Bearer ...`           | 4 hours              | `POST /api/auctions/{id}/receipt-link`                               |
| Reviewer token   | `Authorization: Bearer ...`           | 12 hours             | `reviewerToken` and `reviewerLink` in the judge-room create response |
| Judge key        | header `X-Judge-Key`                  | n/a                  | the host setting `JUDGE_KEY`, handed to judges; optional             |
| Invite token     | body field `invite` of the join route | 24 hours, single use | `POST /api/auctions/{id}/invites`                                    |

A token is bound to one auction and one kind. A wrong kind or another auction is 401; a
valid token whose role may not do the thing is 403.

A reviewer token is read only. It opens the snapshot and event log with a screen's view, the
room ledger (`GET /api/judge/rooms/{id}/ledger`) and the audit page, for its own judge room
only. The ledger route stops answering 15 minutes after the room ends (410 `judge_room_ended`). Judge rooms need no key. The judge key is a separate, limited key (never the operator
key) that a host may set: sent as `X-Judge-Key` on `POST /api/judge/rooms` it skips the public
limits and the response carries `unlocked: true`; `POST /api/judge/key` checks it without
creating anything. A wrong key counts toward the same lockout as a wrong room code. The key
travels only in that header, never in a URL or body. No real credential appears in the spec or
in this page.

## Errors

Every error is JSON with a `message`. The stable code is in `code` on the core and judge
routes and in `error` on the hold, judge and operator routes, so a client reads
`code ?? error`. `detail` is optional extra text, such as the fields that failed validation.
The operator-served routes (`/admin/*`, `/ops/*`, `/metrics*`, the NDJSON export) send only
`{"error": "<code>"}`.

| Status | Meaning                                                                              |
| ------ | ------------------------------------------------------------------------------------ |
| 400    | invalid body, query or path; `detail` lists the fields                               |
| 401    | credential missing, expired, revoked, wrong kind or wrong auction                    |
| 403    | credential valid, role not allowed                                                   |
| 404    | no such auction, hold, room or route (also used so a guessed id reveals nothing)     |
| 409    | conflict with the state of the lot or credential (stale hammer, used invite, closed) |
| 410    | a judge room that has ended                                                          |
| 413    | body larger than 64 KiB                                                              |
| 415    | body is not `application/json`                                                       |
| 429    | rate limited; `Retry-After` gives the seconds to wait                                |
| 500    | internal error; the message never carries internals                                  |
| 503    | store or PayPal unavailable, judge rooms paused                                      |

## Rate limits

Published in the spec as the vendor extension `x-rate-limit` on each operation and as
`x-rate-limits` at the top. Defaults, per source address:

| Scope                                                 | Default                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Every write (POST, DELETE) except health and webhooks | 60 requests per minute, burst 60                                                          |
| Every read (GET, HEAD, OPTIONS)                       | 300 requests per minute, burst 300, a separate looser bucket                              |
| Join (`POST /api/auctions/{id}/join`)                 | 10 per minute, burst 40                                                                   |
| Judge join and lookup by join code                    | 10 and 30 attempts per minute; 5 wrong codes lock the address for 15 minutes              |
| Judge room create                                     | 12 per hour per address, 40 per hour for the host, 15 live rooms, 30 minute lifetime      |
| Judge room create with a judge key                    | 20 per hour for the host, 3 live keyed rooms; wrong keys share the code lockout           |
| Judge room size                                       | 20 bidders                                                                                |
| WebSocket                                             | bids 3 per second (burst 5), frames 20 per second (burst 40), 20 open sockets per address |

The operator can change these through host settings.

## WebSocket protocol

OpenAPI cannot describe a WebSocket, so the spec carries a prose section and this page links
the full contract: [docs site, WebSocket protocol](https://docs.gavel.dualmindlab.tech/docs/reference/websocket-protocol)
and [`docs/specs/realtime/SPEC-realtime.md`](specs/realtime/SPEC-realtime.md).

Short version. A reviewer token can join too, with a screen's view. Connect to `wss://<host>/ws` from an allowed origin. Frames are JSON text,
`{"v":1,"t":"<type>", ...}`, at most 16 KiB from the client. The client sends three types:

```json
{"v":1,"t":"join","token":"<session token>","auctionId":"01JC5ZP4M7Q8R9S0T1V2W3X4Y5"}
{"v":1,"t":"bid","mid":"01JC5ZT3D4E5F6G7H8J9K0M1N2","amount":3000,"source":"manual"}
{"v":1,"t":"confirm_response","confirmId":"c-1","accept":true}
```

The server answers with `registered`, `state`, `price`, `bid_accepted`, `bid_rejected`,
`confirm_request`, `hammer`, `settlement_update`, `audit_event` and `error`. Match a
`bid_accepted` or `bid_rejected` to your bid by `mid`.

An AsyncAPI-style summary of the channel:

| Channel | Direction                    | Messages                                                                                                                                 |
| ------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/ws`   | publish (client to server)   | `join`, `bid`, `confirm_response`                                                                                                        |
| `/ws`   | subscribe (server to client) | `registered`, `state`, `price`, `bid_accepted`, `bid_rejected`, `confirm_request`, `hammer`, `settlement_update`, `audit_event`, `error` |

## Try it without any key: a judge room

Judge rooms are sandbox auctions anyone can open on a host that has them on. Replace `$API`
with the host address.

```sh
API=https://api.gavel.dualmindlab.tech

# 1. Is the host taking rooms?
curl -s $API/api/judge/capabilities

# 2. Create a room. The response carries auctionId, joinCode and the auctioneer, screen and
#    reviewer tokens. On a host with a judge key, add -H "x-judge-key: $JUDGE_KEY".
curl -s -X POST $API/api/judge/rooms -H 'content-type: application/json' -d '{"title":"Sandbox demo lot"}'

# 3. Join as a bidder with the code. The response carries the session token.
curl -s -X POST $API/api/judge/join -H 'content-type: application/json' \
  -d '{"code":"K7M2QX","displayName":"Asha"}'

# 4. Place a simulated hold (no PayPal login). 2000 and 5000 are the offered ceilings.
curl -s -X POST $API/api/judge/rooms/$AUCTION_ID/sim-hold \
  -H "authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' \
  -d '{"ceilingCents":5000,"name":"Asha"}'

# 5. Bid over the WebSocket (see above), then hammer as the auctioneer.
curl -s -X POST $API/api/auctions/$AUCTION_ID/control \
  -H "authorization: Bearer $AUCTIONEER_TOKEN" -H 'content-type: application/json' \
  -d '{"controlId":"ctl-1","action":"hammer","args":{"closeNow":1}}'

# 6. Read the verifiable ledger as the reviewer (read only).
curl -s $API/api/judge/rooms/$AUCTION_ID/ledger -H "authorization: Bearer $REVIEWER_TOKEN"

# 7. Make and read a receipt as the bidder.
curl -s -X POST $API/api/auctions/$AUCTION_ID/receipt-link -H "authorization: Bearer $SESSION_TOKEN"
curl -s $API/api/auctions/$AUCTION_ID/receipt -H "authorization: Bearer $RECEIPT_TOKEN"
```

## SDKs with APIMatic

GAVEL is entered for the sponsor prize "Best Use of APIMatic". Honest status:

- The OpenAPI 3.1 document is ready, linted in CI and checked against the router.
- No SDK and no developer portal has been generated yet. Generation needs an APIMatic
  account, which does not exist yet. Nothing in this repository claims a generated SDK, and
  nothing generated is checked in.

What generating them involves, once the account exists:

1. Create an APIMatic account (https://www.apimatic.io).
2. In APIMatic, import the API from the raw file URL
   `https://raw.githubusercontent.com/harshbhx/gavel-auction/main/openapi/gavel.yaml`
   or upload `openapi/gavel.yaml`. The same file is served at
   https://docs.gavel.dualmindlab.tech/openapi.yaml.
3. Let APIMatic validate it, and fix anything it reports in `openapi/gavel.yaml`.
4. Generate the SDKs, starting with TypeScript, and the API developer portal (reference
   docs, code samples, try-it).
5. Publish or host the portal, then record the portal address and the generated SDK in this
   file and in the README.

Notes for the SDK output: the sandbox host is the default server in the spec; the bearer
token kinds are modelled as separate security schemes (`auctioneerAuth`, `screenAuth`,
`sessionAuth`, `receiptAuth`) and the operator key as `adminKey`; the WebSocket is not part
of what an OpenAPI-based SDK generates, so live bidding stays on the documented socket
protocol.
