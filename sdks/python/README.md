# GAVEL host API SDK

[![Built with APIMatic][apimatic-badge]][apimatic-url] [![License: MIT][license-badge]][license-url] [![Python 3.10+][python-badge]][python-url]

The GAVEL host API SDK for Python provides access to the GAVEL host API REST APIs from Python applications.

> [!TIP]
> **Looking for a specific signature, model, enum, or error type?** This SDK ships a generated
> **[SDK map](sdk-map.md)** -- a lookup index of the SDK's entire Python surface. Consult it before
> scanning the source tree; details under [SDK map](#sdk-map).

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

Add the Python SDK to your project from its folder, with whichever package manager your project uses. Give each tool a path containing a slash, such as `../gavel-sdk` — a bare folder name is looked up on PyPI instead, and resolves to whatever project holds that name there:

```bash
pip install <path-to-sdk>
```

```bash
uv add <path-to-sdk>
```

```bash
poetry add <path-to-sdk>
```

---

## Quick Start

### Synchronous client

Construct `GavelHostApiClient` with keyword arguments, and call `close()` when you are done. Every argument is optional; the full list is in the [SDK map](sdk-map.md).

```python
from gavel_host_api import GavelHostApiClient

client = GavelHostApiClient(
    admin_key="YOUR_API_KEY",
    auctioneer_auth="YOUR_BEARER_TOKEN",
    screen_auth="YOUR_BEARER_TOKEN",
    reviewer_auth="YOUR_BEARER_TOKEN",
    judge_key="YOUR_API_KEY",
    session_auth="YOUR_BEARER_TOKEN",
    receipt_auth="YOUR_BEARER_TOKEN",
    environment="production",
)

# TODO: call endpoints here -- see api-reference.md

client.close()
```

Alternatively, scope it -- `with GavelHostApiClient(...) as client:` closes the pool on exit; see [Best Practices](#best-practices).

`Client` is exported as an alias of `GavelHostApiClient`, so `from gavel_host_api import Client` also works.

The SDK accepts every model-typed input in two interchangeable spellings, both type-checked: the typed model, or a plain dict with the same keys -- the `OrDict` and `Model | ModelDict` unions in the [SDK map](sdk-map.md). Pick whichever suits the call site: the dict form needs no import, while the model form adds a keyword-checked constructor and editor completion.

### Asynchronous client

`AsyncGavelHostApiClient` mirrors `GavelHostApiClient` with **identical method names**, and every endpoint method is a coroutine. It takes the same arguments, with some differences -- for example, the transport argument is `custom_async_http_client`.

```python
from asyncio import run

from gavel_host_api import AsyncGavelHostApiClient


async def main() -> None:
    client = AsyncGavelHostApiClient(
        admin_key="YOUR_API_KEY",
        auctioneer_auth="YOUR_BEARER_TOKEN",
        screen_auth="YOUR_BEARER_TOKEN",
        reviewer_auth="YOUR_BEARER_TOKEN",
        judge_key="YOUR_API_KEY",
        session_auth="YOUR_BEARER_TOKEN",
        receipt_auth="YOUR_BEARER_TOKEN",
        environment="production",
    )
    # TODO: call endpoints here, awaiting each -- see api-reference.md
    await client.aclose()


run(main())
```

Alternatively, scope it -- `async with AsyncGavelHostApiClient(...) as client:` closes the pool on exit. Only the async spelling is `aclose`, matching httpx2; see [Best Practices](#best-practices).

`AsyncClient` is the exported alias. Each client accepts **only** its own transport argument; passing the other's is a `TypeError` at runtime and an error under mypy.

---

## Usage

Two generated references cover the SDK; each answers a different question:

| Reference | For |
| --- | --- |
| **[API Reference](api-reference.md)** | Usage guidance for a single **parsed** operation: `client.<group>.<operation>(...)` returns the typed payload and raises `ApiError` on any non-2xx, with `.error` the typed error body, or `RawError` for a status the operation does not document. |
| **[Raw API Reference](raw-api-reference.md)** | The same for the **raw** variant: `client.<group>.with_raw_response.<operation>(...)` returns `ApiResult[T, E]` and never raises for an API error. |

Both API references carry every one of the 47 operations, with a sync and an async sample and a parameter table each.

## SDK map

This SDK ships a generated **SDK map** -- [`sdk-map.md`](sdk-map.md) -- a deterministic, lookup-oriented table of contents of the SDK's Python surface, generated by APIMatic alongside this SDK.

Consult the map before scanning or grepping the source: it answers call-level contract questions by lookup, and for anything it does not carry -- model shapes, enum values, an endpoint's route or behavioural prose -- it names the one source file to read. How to read the map itself, including the SDK-wide defaults its rows rely on, is stated at the top of [`sdk-map.md`](sdk-map.md).

## Logging

The SDK logs every HTTP exchange through Python's standard `logging` module, under the `gavel_host_api` logger, and configures nothing itself: with no logging set up, nothing is printed unless `GAVEL_HOST_API_LOG` is set. Turn it on as for any library:

```python
import logging

logging.basicConfig()  # your application's handler; the root stays at WARNING
logging.getLogger("gavel_host_api").setLevel(logging.INFO)  # the SDK's lines; DEBUG adds the dumps that logging_options turns on
```

Or set one environment variable before the process starts, for a run you cannot edit: `GAVEL_HOST_API_LOG=info` writes the request and response lines, `GAVEL_HOST_API_LOG=debug` adds the request headers, the request body and the response headers. If your application has configured logging, its handlers and format are used; otherwise the SDK writes to stderr.

Choose the detail with `logging_options`, a `LoggingOptions` from `gavel_host_api.core`:

```python
from gavel_host_api import GavelHostApiClient
from gavel_host_api.core import LoggingOptions

client = GavelHostApiClient(
    logging_options=LoggingOptions(log_request_headers=True, log_response_headers=True, log_request_body=True)
)
```

A plain dict with the same keys is accepted too, as for every model-typed argument (see [Quick Start](#quick-start)): `logging_options={"log_request_headers": True}`.

| Option | Default | Effect |
| --- | --- | --- |
| `log_request_headers` | `False` | Log the sent headers at DEBUG, masked. |
| `log_response_headers` | `False` | Log the received headers at DEBUG, masked. |
| `log_request_body` | `False` | Log the request body at DEBUG: its text when in memory, a description when streamed. |
| `body_size_limit` | `32768` | Bytes of a logged body kept before it is cut. |
| `redaction_placeholder` | `"REDACTED"` | What a hidden value prints as. |
| `unmask_headers` | none | Header names to show although they are not on the safe list. |
| `mask_headers` | none | Header names to hide although they are on the safe list. |
| `mask_keys` | 11 credential names | Query and form keys whose values are always hidden; naming a set replaces the default. |

A single call can be quietened with `request_options={"log_level": logging.WARNING}`: records below that level are not written for that call. It never turns on a record the client's options leave off. Header, query and form values print `REDACTED` unless known safe; a JSON body is printed as sent, so enable `log_request_body` only where its content may be logged; a response body is never logged. The levels and every field are under **Logging** in the SDK map.

## Best Practices

> [!TIP]
> Use a **single `GavelHostApiClient` instance** for the lifetime of your application and reuse it across
> all requests. Each instance owns its own connection pool, so an instance per request forfeits
> connection reuse and leaks pools that are never closed.

Match the disposal to the client's lifetime: an application-lifetime client is closed once at shutdown with `close()` / `aclose()`; where the lifetime fits a block, `with GavelHostApiClient() as client:` / `async with AsyncGavelHostApiClient() as client:` releases it automatically. Both are idempotent, but a closed client is not reusable: the next call raises. The client closes **whatever transport it holds**, including one you supplied via `custom_http_client` / `custom_async_http_client`; if you intend to reuse your own transport across clients, don't hand its lifetime to a `with` block.

**Retries are on by default**: a failed idempotent request — a retryable status or no response at all — is sent again up to three times before the call gives up. Pass `retry_options=0` to turn it off, for instance in a test that stubs an error response; the policy and its defaults are under **Retries** in the SDK map.

## License

This SDK is distributed under the [MIT License][license-url].

---

## Support

Refer to the [API reference](api-reference.md) for detailed information on available operations with code samples.

---

[license-url]: LICENSE
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg
[apimatic-url]: https://www.apimatic.io
[apimatic-badge]: https://www.apimatic.io/hubfs/Built-with-APIMatic-badge.svg
[python-url]: https://www.python.org/downloads/
[python-badge]: https://img.shields.io/badge/python-3.10%2B-blue.svg
