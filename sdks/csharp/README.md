# GAVEL host API

[![Built with APIMatic][apimatic-badge]][apimatic-url] [![License: MIT][license-badge]][license-url]

The GAVEL host API SDK for .NET provides access to the GAVEL host API REST APIs from .NET applications.

> [!TIP]
> **Looking for a specific signature, model, enum, or error type?** This SDK ships a generated,
> machine-readable **[SDK map](sdk-map.md)** — a lookup index of the SDK's entire C# surface. Consult it
> **before** grepping or scanning the source tree; it answers most contract questions directly and,
> when a source file is genuinely needed, names the exact one to open. Details under [SDK map](#sdk-map).

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

Every error is JSON. The fields vary by route family because the host grew in layers.
One rule is true everywhere: read `code ?? error` for the stable code. The fields each
family sends:

| Family | Fields | Notes |
| --- | --- | --- |
| Core `/api/auctions/**` (create, token routes, control, kill, invites, join, read, receipts) | `code`, `message`, optional `detail` | Exceptions: the 429 of the code lookup `GET /api/auctions/{id}` (`rate_limited`, `code_locked`) and of `POST /api/auctions/{id}/join` (`rate_limited`) send `error` and `message`, no `code`. |
| Hold routes `/api/holds/**` | hold failures: `error`, `message`; auth, body and state failures (`unauthorized`, `bad_message`, `closed`): `code`, `message` | The hold codes are in `HoldErrorCode`. |
| Judge routes `/api/judge/**` | `error`, `code` and `message` | Same value in `error` and `code` on the judge-specific failures; errors raised by shared code (for example `bad_message`, `forbidden`) carry `code` and `message` only. |
| Operator routes (`/admin/**`, `/metrics`, `/ops/**`) and the export route | `error` only | No `message`, no `code`. |
| Host-level answers before any route runs: the per-address limiter 429, the unknown-route 404, the catch-all 500 | `error` only (`rate_limited`, `not_found`, `internal`) | Also on `/api/**` paths. The 429 carries `Retry-After`. |

`message` is therefore present on every error of the core, hold and judge routes, but not
on the operator routes and the host-level answers above. `detail` is optional extra text,
for example the field paths that failed validation.

`ErrorCode` lists the codes of the realtime protocol and the core routes. Some routes
send further codes that are not in it (`ExtraErrorCode`, the hold codes in
`HoldErrorCode`); treat `code` and `error` as plain strings and do not fail on a value you
do not know. See the `Error` schema.

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
`X-Request-Id` and `Retry-After` (also on the early 429, 404 and 500 answers, for the
allowed origins and for the docs origin on its routes).

A cross-origin write (POST or DELETE with an `Origin` header) from an origin that is not
allowed is refused with `403 {"code":"forbidden","message":"origin not allowed"}` before
any handler runs; see the `OriginForbidden` response. Callers that send no `Origin`
(curl, server to server) are not affected. The docs site origin
(`https://docs.gavel.dualmindlab.tech`, setting `JUDGE_DOCS_ORIGINS`) may call only these
routes from a browser: `/api/judge/capabilities`, `/api/judge/key`, `/api/judge/join`,
`/api/judge/rooms`, `/api/judge/rooms/{id}/sim-hold`, `/api/judge/rooms/{id}/bids`,
`/api/judge/rooms/{id}/ledger`, `/api/auctions/{id}/control`,
`/api/auctions/{id}/receipt-link` and `/api/auctions/{id}/receipt`. Every other route
(the snapshot, the event log, `GET /api/auctions/{id}`, kill, invites, holds and all
operator routes) gets no CORS headers for the docs origin, and a write from it is 403.

## Not in this document

- **WebSocket protocol.** Live bidding runs on `wss://<host>/ws` and OpenAPI cannot model
  it. See the section "WebSocket protocol" below and
  https://github.com/harshbhx/gavel-auction/blob/main/docs/API.md.
- **Method on the health routes.** `/healthz`, `/readyz` and `/version` answer on any HTTP
  method (the host matches them by path only), so a `POST` to them also returns 200. The
  document lists `GET`, the method to use. Every other operator route answers 405 with an
  `Allow` header for a wrong method.
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

Add the .NET SDK as a project reference into your solution:

```bash
dotnet add reference <path-to-sdk>/src/GavelHostApi/GavelHostApi.csproj
```

The project takes its build settings from the files around it, so reference it in place. Building from source needs the .NET 10 SDK (C# 14); the package itself targets netstandard2.0.

The assembly embeds its PDB, so stack traces carry SDK file and line numbers.

---

## Building from source

```bash
dotnet pack src/GavelHostApi/GavelHostApi.csproj -c Release
```

Release packs come from CI, where `CI=true` makes the build deterministic; to reproduce that locally add `-p:ContinuousIntegrationBuild=true`.

The generator never emits `Directory.Build.targets`, so a customer-owned one at the repo root is MSBuild's auto-imported customization seam. It imports after the props and the project body into every project under the root, so put SDK-only settings under `<PropertyGroup Condition="'$(MSBuildProjectName)' == 'GavelHostApi'">`.

It overrides every property the SDK reads when targets run (package metadata, `Version`, `AssemblyVersion`, compiler warnings, package references, which under central package management use `VersionOverride`). It cannot change values the SDK derives earlier: `TargetFramework(s)`, `AssemblyName` and output paths stay generator settings; turning off `GenerateDocumentationFile` also needs `<DocumentationFile />`; a `ContinuousIntegrationBuild` set there also needs `<DeterministicSourcePaths>true</DeterministicSourcePaths>`.

The SDK's props files are a boundary: a parent repository's `Directory.Build.props` does not apply, while a parent `Directory.Build.targets` does.

APIMatic's delivery tools do not yet preserve `Directory.Build.targets` across regeneration — list it in `.codegenignore` when publishing to GitHub.

---

## Quick Start

### Dependency Injection

Register the client with `IServiceCollection` and resolve it from the container. The `HttpClient` is managed by `IHttpClientFactory`. Configure the client's behavior through [GavelHostApiClientOptions](src/GavelHostApi/GavelHostApiClientOptions.cs).

```csharp
services.AddGavelHostApiClient(options =>
{
    options.AdminKey = "YOUR_API_KEY";
    options.AuctioneerAuth = "YOUR_BEARER_TOKEN";
    options.ScreenAuth = "YOUR_BEARER_TOKEN";
    options.ReviewerAuth = "YOUR_BEARER_TOKEN";
    options.JudgeKey = "YOUR_API_KEY";
    options.SessionAuth = "YOUR_BEARER_TOKEN";
    options.ReceiptAuth = "YOUR_BEARER_TOKEN";
    options.Environment = ServerEnvironment.Production;
    // TODO: configure more client options here
});
```

### Direct Instantiation

Create the client by passing an `HttpClient` you manage yourself. Configure the client's behavior through [GavelHostApiClientOptions](src/GavelHostApi/GavelHostApiClientOptions.cs).

```csharp
var httpClient = new HttpClient();
// TODO: configure more client options here
var options = new GavelHostApiClientOptions
{
    AdminKey = "YOUR_API_KEY",
    AuctioneerAuth = "YOUR_BEARER_TOKEN",
    ScreenAuth = "YOUR_BEARER_TOKEN",
    ReviewerAuth = "YOUR_BEARER_TOKEN",
    JudgeKey = "YOUR_API_KEY",
    SessionAuth = "YOUR_BEARER_TOKEN",
    ReceiptAuth = "YOUR_BEARER_TOKEN",
    Environment = ServerEnvironment.Production,
};
var client = new GavelHostApiClient(httpClient, options);
```

### Credentials, tokens and 401s

Every credential is an option on `GavelHostApiClientOptions`. A static credential can also come from a provider that is asked on every request, so a rotated secret reaches the next call without rebuilding the client:

```csharp
var options = new GavelHostApiClientOptions { AdminKeyProvider = async ct => await vault.ReadAsync("api-key", ct) };
```

When a server answers `401 Unauthorized`:

- A call with a static credential (bearer token, API key, basic auth) is not retried; a provider, if you set one, is asked again on the next call, not on this one. A throwing operation raises `ApiException` with `StatusCode` 401.

### Required and optional auth

An operation sends only the credentials its API declares. If a required credential is not configured, the call fails before anything is sent with an `AuthSchemeException` that names the scheme (`… requires the AdminKey scheme, which is not configured.`). An operation that accepts any of several sends the first configured credential that applies, in the order the API lists them; a configured one that fails falls through to the next, and all of them are named when none is configured. Only an operation whose API allows anonymous callers (an empty security requirement in the spec) is sent without credentials, and only when no whole alternative is configured (every credential in an AND group); a configured alternative is sent, and a provider that returns nothing fails the call. A credential that is set but blank is treated as configured and sent as-is: the SDK checks presence, never content.

### Credentials from environment variables

Any credential option left `null` is read from an environment variable when the client is constructed. The variable name is the SDK name and the option's name, each in upper snake case, plus the member name for multi-member credentials:

| Option | Environment variables |
| --- | --- |
| `AdminKey` | `GAVEL_HOST_API_ADMIN_KEY` |
| `AuctioneerAuth` | `GAVEL_HOST_API_AUCTIONEER_AUTH` |
| `ScreenAuth` | `GAVEL_HOST_API_SCREEN_AUTH` |
| `ReviewerAuth` | `GAVEL_HOST_API_REVIEWER_AUTH` |
| `JudgeKey` | `GAVEL_HOST_API_JUDGE_KEY` |
| `SessionAuth` | `GAVEL_HOST_API_SESSION_AUTH` |
| `ReceiptAuth` | `GAVEL_HOST_API_RECEIPT_AUTH` |
| logging | `GAVEL_HOST_API_LOG` = `info`, `debug` or `trace` (read only when no `ILoggerFactory` is set; `AddGavelHostApiClient` always supplies the container's) |

Rules:

- A value set in code always wins over the environment, including the placeholder assignments in the Quick Start samples; delete the line for any credential you supply through an environment variable.
- A variable that is unset, empty or whitespace counts as not configured.
- Variables are read once, when the client is constructed. Changing them afterwards has no effect on an existing client.

Hosted applications that already use the .NET options pattern can bind the whole options object from `IConfiguration` instead, which picks up environment variables through the configuration provider (`GavelHostApi__AdminKey`, and so on):

```csharp
services.AddGavelHostApiClient(options => configuration.GetSection("GavelHostApi").Bind(options));
```

Both paths coexist: a slot the bound configuration leaves `null` still falls back to its environment variable.

---

## Usage

For code examples and error responses, see [API Reference](api-reference.md).

## Enums

Every enum the spec declares is a sealed record with one `public static readonly` member per value (`Error4.BidRejected`), a JSON converter, and a `Match` that makes handling exhaustive: one `on{Member}` arm per known value, then `otherwise`, which receives the raw wire value the server sent when it is one this SDK does not declare.

```csharp
var label = received.Match(onBidRejected: () => "BidRejected", otherwise: raw => $"undeclared ({raw})");
```

Prefer named arguments as above. The arms are positional, in the order the spec lists its values, and a regenerated SDK that adds or moves a value changes the `Match` signature: a positional call site compiled against the old shape either stops compiling or, if the assembly is not rebuilt, throws `MissingMethodException` at the first call, and a reordered value can rebind a positional argument to a different member without any diagnostic. Treat an added or moved enum value as a breaking change of that enum. Code that must survive regeneration untouched compares instead of matching: `received == Error4.BidRejected` or `received.Is(rawValue)` against a raw wire value; neither reopens construction.

A value the SDK does not declare still round-trips: `IsKnownValue()` tells you whether it is one of the generated members, and sending the instance back echoes the server's own casing. You cannot construct an undeclared value yourself — there is no public factory — so a typo cannot compile; resolve a raw value with `Error4.TryGetKnownValue("bid_rejected", out var known)`.

A spec value whose name would collide with the enum's own name, with a member every enum inherits or generates (such as `Value`, `Match` or `IsKnownValue`), or with a member of `object` takes a `Member` suffix — a value `value` becomes `ValueMember` — and the other members keep their plain names.

## SDK map

This SDK ships a generated **SDK map** — [`sdk-map.md`](sdk-map.md) plus the [`map/`](map/) pages — a deterministic, lookup-oriented table of contents of the SDK's C# surface, generated by APIMatic alongside this SDK.

**Read it before scanning the source.** Whether you are an AI coding assistant or searching by hand, the map answers "what is the exact …" by lookup for every call-level contract, and for anything it does not carry it names the one file that does — so you never have to search the source tree:

- **[`sdk-map.md`](sdk-map.md)** — the index: client construction, servers/auth, the options/retry reference, the SDK-wide defaults the operation rows rely on, and link tables into [`map/`](map/).
- **[`map/operations/`](map/operations/)** — one page per controller: the exact C# signature, the return type, the error type with its typed `TryGet…` accessors, and pagination — plus, per operation, a **Type sources** table naming the file that declares every type that operation mentions.

Model shapes — record fields with their JSON wire names, enum member names and wire values, `OneOf`/`AnyOf` union variants — are **not** duplicated in the map. Take the path from the operation's Type sources table and read the declaring file; it is the single source of truth and cannot go stale against the code.

**Each operation row states what is specific to that operation.** The SDK-wide defaults are stated once in [`sdk-map.md`](sdk-map.md) — throw-only (no `Result`-style no-throw variants), no pagination, the four fixed `RawError` accessors, the `Default` server group — and a row appears only where its operation departs from one. A row silent on pagination is telling you that operation has none.

The **HTTP verb and route**, and the endpoint's **behavioural prose**, live on the operation itself, in the source file named at the top of its operations page. Read them there when something needs them — wiring a mock, reading a provider log, or settling a rule about what you must pass.

**Workflow:** look the fact up in the map → where the map leaves something ambiguous, open the **one** source file the row names → the compiler is the backstop (a name that isn't in the map won't build). Don't scan or grep the tree to find things — the map is the locator.

### Which one to reach for

The map and the [API Reference](api-reference.md) answer different questions, and the map is generated from this SDK's source so it stays in lockstep with the code it describes.

| Use | For |
| --- | --- |
| **[`sdk-map.md`](sdk-map.md) + [`map/`](map/)** | Traversing the SDK and working out its surface — locating the operation you need (this SDK exposes **48 operations**), its exact signature and request record, the shape and JSON wire names of the models it takes and returns, which error type it throws and how to read it, and the source file behind any of it. This is the index to consume the SDK from, and the one to reach for first. |
| **[`api-reference.md`](api-reference.md)** | Usage guidance for a single operation once you know which one you want — a runnable code sample, a link to its request record, and the error responses it can return. |

## Error Handling

Operations throw when the server answers with an error status. `TError` is the operation's error type from the spec — `RawError` (the status code plus the raw body) when the spec declares none.

```csharp
using GavelHostApi.Core.Exceptions;     // the exception family
using GavelHostApi.Errors;              // generated error types such as CreateAuctionError
using GavelHostApi.Requests.Auctions;   // request records such as CreateAuctionOperationRequest
using GavelHostApi.Models;              // models such as CreateAuctionRequest
using GavelHostApi.Models.Enums;        // models such as Mode

try
{
    var response = await client.Auctions.CreateAuction(new CreateAuctionOperationRequest
    {
        Body = new CreateAuctionRequest
        {
            Title = "Charity quilt",
            Config = new AuctionConfig
            {
                Mode = Mode.English,
                Reserve = 10000,
                MinIncrement = 500,
                EndTs = 1893456000000L,
                SoftCloseWindowMs = 30000,
                SoftCloseExtensionMs = 30000,
                MaxExtensions = 5,
                CeilingPresets = [10000, 25000, 50000],
                ConfirmConfidenceThreshold = 0.85d,
            },
            FundraiserGoalCents = 500000,
        },
    });
}
catch (ApiException<CreateAuctionError> ex)
{
    // "POST <server>/api/auctions returned 400 (BadRequest)."
    Console.Error.WriteLine(ex.Message);
    if (ex.Error.TryGetError5(out var error5))
    {
        // TODO: handle 'error5' of type Error5
    }
}
```

`Match` on an error type is exhaustive: one `on{Arm}` arm per body the operation declares, each receiving the parsed body, and a last `otherwise` arm that receives the `RawError` (status code plus raw body) of a status the operation does not declare, such as a gateway's 502. An arm is a body, not a status: statuses that share a body share an arm, and the status itself is on `result.StatusCode` or `ex.StatusCode`. `TryGet{Arm}` reads one arm when that is all you need, as in the `catch` above; `TryGetRawError` is the accessor behind `otherwise`.

Prefer named arguments, as with enums and unions: the arms are positional, in the order of their names, and a regenerated SDK whose operation gains or loses an error body changes the `Match` signature — a positional call site stops compiling or, if the assembly is not rebuilt, throws `MissingMethodException` at the first call. Treat an added or removed error body as a breaking change of that error type. A status added for a body the operation already declares changes nothing. Code that must survive regeneration untouched uses the `TryGet{Arm}` accessors instead.

Everything the SDK raises for a call derives from `SdkException`, which carries the failed call's `Method` and `RequestUri`. Every message starts with that call, and the underlying cause is always `InnerException`.

| Exception | When | Extra members |
| --- | --- | --- |
| `ApiException<TError>` | The server answered with an error status | `Error`, plus `StatusCode`, `Headers` and `ContentType` from `ApiException` |
| `ResponseDeserializationException` | A response body did not match the type the spec declares | `TargetType`, plus the `ApiException` members |
| `SdkConnectionException` | The request could not be sent, or the response body could not be read |  |
| `SdkTimeoutException` | An attempt, the transport, or a Server-Sent Events stream went silent (derives from `SdkConnectionException`) | `Timeout` |
| `AuthSchemeException` | A required credential is not configured, a provider returned nothing, or a credential could not be applied — for example the OAuth2 token endpoint refused it | `SchemeFailures` |

Catch from specific to general: `ApiException` means the server answered, `SdkConnectionException` means it did not, and `SdkException` is everything the SDK raises. Your own cancellation surfaces as the usual `OperationCanceledException`, never wrapped.

---

## Best Practices

> [!TIP]
> Use a **single `GavelHostApiClient` instance** for the lifetime of your application and
> reuse it across all requests. Creating a new instance per request might exhaust the
> connection pool.

> [!TIP]
> Let the SDK own timeouts. `RetryOptions.Timeout` bounds **each attempt** (default 100 s)
> and a timed-out attempt is retried under the configured retry policy before it surfaces as
> `SdkTimeoutException`; `Retry-After` response headers are honored when the server sends them.
> Set `HttpClient.Timeout` to `Timeout.InfiniteTimeSpan` (or comfortably above
> `RetryOptions.Timeout`) so the transport does not race the SDK — a transport-level timeout
> surfaces as the same `SdkTimeoutException` but cannot be retried.

> [!TIP]
> The SDK reads time only through `GavelHostApiClientOptions.TimeProvider` (default
> `TimeProvider.System`): retry backoff, `Retry-After`, the SSE idle timeout, OAuth2 token
> expiry and the logged request durations all follow it. Under `AddGavelHostApiClient` a
> `TimeProvider` registered in the container is picked up automatically, and setting the
> option explicitly wins. To fake time in your own tests use a provider that implements
> timers, such as `FakeTimeProvider` from `Microsoft.Extensions.TimeProvider.Testing`, so
> retries and idle timeouts advance with it.

## License

This SDK is distributed under the [MIT License](https://licenses.nuget.org/MIT).

---

## Support

Refer to the [API reference](api-reference.md) for detailed information on available operations with code samples.

---

[license-url]: https://licenses.nuget.org/MIT
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg
[apimatic-url]: https://www.apimatic.io
[apimatic-badge]: https://img.shields.io/badge/Built%20with-APIMatic-blue.svg
