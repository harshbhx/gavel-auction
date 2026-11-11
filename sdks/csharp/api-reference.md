# Reference

Every operation below is shown in its throwing form. On an error status it throws `ApiException<TError>` — the status code, headers, content type and the operation's error type, `RawError` (the raw body) when the spec declares none — and where an operation offers an `…AsResult` sibling, that sibling returns `ApiResult<TResponse, TError>` instead. A request that produces no usable response surfaces as `SdkConnectionException` or `SdkTimeoutException`, a body that does not match the documented response type as `ResponseDeserializationException`, and a required credential that is not configured, or one that cannot be applied, as `AuthSchemeException`; all of them derive from `SdkException` and name the failed call. See [README → Error Handling](README.md#error-handling).

> Source: [GavelHostApiClient](src/GavelHostApi/GavelHostApiClient.cs)

## Auctions

> Source: [Auctions](src/GavelHostApi/Api/Auctions.cs)

<details>
<summary><code>Task&lt;CreateAuctionResponse&gt; CreateAuction(CreateAuctionOperationRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. Creates the auction, reserves a 6 character join code, and returns links
for the auctioneer console and the projector screen. The tokens are inside the links
(fragment `#token=`), valid 12 hours.

End time rules: `config.endTs` must be strictly after the host's clock and at most 24
hours ahead (400 `bad_message`, "end time is more than a day away", otherwise). The
host runs a flat English lot with one hold per event: `mode` other than `english`,
`holdScope: lot` and an `incrementLadder` are refused with 400 `bad_message`
("unsupported mode, increment ladder or hold scope"). Answers 503 `room_cap` when the
host holds the most auctions it allows.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
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
    // TODO: Handle 'response' of type CreateAuctionResponse
}
catch (ApiException<CreateAuctionError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[CreateAuctionOperationRequest](src/GavelHostApi/Requests/Auctions/CreateAuctionOperationRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[CreateAuctionResponse](src/GavelHostApi/Models/CreateAuctionResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[CreateAuctionError](src/GavelHostApi/Errors/CreateAuctionError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;AuctionPublic&gt; GetAuction(GetAuctionRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

No credential. `id` is the auction id or its join code (any case; spaces, dashes and a
`GVL-` prefix are ignored). Looking up by code is guess-protected: after 5 wrong codes
a source address is locked out for 15 minutes (429 `code_locked`).

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Auctions.GetAuction(new GetAuctionRequest { Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
    // TODO: Handle 'response' of type AuctionPublic
}
catch (ApiException<GetAuctionError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[GetAuctionRequest](src/GavelHostApi/Requests/Auctions/GetAuctionRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[AuctionPublic](src/GavelHostApi/Models/AuctionPublic.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[GetAuctionError](src/GavelHostApi/Errors/GetAuctionError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;Revoked&gt; RevokeAllAuctioneerTokens(RevokeAllAuctioneerTokensRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. Kills every auctioneer token of the auction and issues no new one.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Auctions.RevokeAllAuctioneerTokens(new RevokeAllAuctioneerTokensRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    });
    // TODO: Handle 'response' of type Revoked
}
catch (ApiException<RevokeAllAuctioneerTokensError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[RevokeAllAuctioneerTokensRequest](src/GavelHostApi/Requests/Auctions/RevokeAllAuctioneerTokensRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[Revoked](src/GavelHostApi/Models/Revoked.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[RevokeAllAuctioneerTokensError](src/GavelHostApi/Errors/RevokeAllAuctioneerTokensError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;Revoked&gt; RevokeAuctioneerToken(RevokeAuctioneerTokenRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. For a lost or leaked link when you know its token id.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Auctions.RevokeAuctioneerToken(new RevokeAuctioneerTokenRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
        Body = new ApiAuctionsAuctioneerRevokeRequest { Jti = "01JC5ZQ0A1B2C3D4E5F6G7H8J9" },
    });
    // TODO: Handle 'response' of type Revoked
}
catch (ApiException<RevokeAuctioneerTokenError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[RevokeAuctioneerTokenRequest](src/GavelHostApi/Requests/Auctions/RevokeAuctioneerTokenRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[Revoked](src/GavelHostApi/Models/Revoked.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[RevokeAuctioneerTokenError](src/GavelHostApi/Errors/RevokeAuctioneerTokenError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiAuctionsAuctioneerRotateResponse&gt; RotateAuctioneerToken(RotateAuctioneerTokenRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. Kills every auctioneer token issued before now and returns a fresh link.
A leaked auctioneer link cannot do this, by design.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Auctions.RotateAuctioneerToken(new RotateAuctioneerTokenRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    });
    // TODO: Handle 'response' of type ApiAuctionsAuctioneerRotateResponse
}
catch (ApiException<RotateAuctioneerTokenError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[RotateAuctioneerTokenRequest](src/GavelHostApi/Requests/Auctions/RotateAuctioneerTokenRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiAuctionsAuctioneerRotateResponse](src/GavelHostApi/Models/ApiAuctionsAuctioneerRotateResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[RotateAuctioneerTokenError](src/GavelHostApi/Errors/RotateAuctioneerTokenError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

## BiddingAccess

> Source: [BiddingAccess](src/GavelHostApi/Api/BiddingAccess.cs)

<details>
<summary><code>Task&lt;ApiAuctionsInvitesResponse&gt; CreateInvites(CreateInvitesRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Auctioneer token only. Each invite is a single-use link, valid 24 hours, for one new
bidder id. Between 1 and 50 per call.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.BiddingAccess.CreateInvites(new CreateInvitesRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
        Body = new ApiAuctionsInvitesRequest { Count = 2 },
    });
    // TODO: Handle 'response' of type ApiAuctionsInvitesResponse
}
catch (ApiException<CreateInvitesError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[CreateInvitesRequest](src/GavelHostApi/Requests/BiddingAccess/CreateInvitesRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiAuctionsInvitesResponse](src/GavelHostApi/Models/ApiAuctionsInvitesResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[CreateInvitesError](src/GavelHostApi/Errors/CreateInvitesError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;JoinResponse&gt; JoinAuction(JoinAuctionRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

No header credential: the invite token goes in the body. `id` may be the auction id or
its join code. The invite is burned on use; a second use answers 409 `invite_used`.
Returns the session token for bidding and the WebSocket address.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.BiddingAccess.JoinAuction(new JoinAuctionRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
        Body = new ApiAuctionsJoinRequest { Invite = "INVITE_TOKEN" },
    });
    // TODO: Handle 'response' of type JoinResponse
}
catch (ApiException<JoinAuctionError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[JoinAuctionRequest](src/GavelHostApi/Requests/BiddingAccess/JoinAuctionRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[JoinResponse](src/GavelHostApi/Models/JoinResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[JoinAuctionError](src/GavelHostApi/Errors/JoinAuctionError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;Invite&gt; ReissueInvite(ReissueInviteRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Auctioneer token only. A bidder who lost their tab gets a fresh single-use invite for
the same bidder id, so their hold and bids stay theirs. Answers 404 for a bidder who
has no hold in the room.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.BiddingAccess.ReissueInvite(new ReissueInviteRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
        BidderId = "01J9ZZ0000000000000000000B",
    });
    // TODO: Handle 'response' of type Invite
}
catch (ApiException<ReissueInviteError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[ReissueInviteRequest](src/GavelHostApi/Requests/BiddingAccess/ReissueInviteRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[Invite](src/GavelHostApi/Models/Invite.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[ReissueInviteError](src/GavelHostApi/Errors/ReissueInviteError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

## Control

> Source: [Control](src/GavelHostApi/Api/Control.cs)

<details>
<summary><code>Task&lt;ControlResponse&gt; ControlAuction(ControlAuctionRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Auctioneer token only (a session or screen token authenticates but is refused with 403).
Idempotent by `controlId`: repeat the same id with the same action and you get the same
answer. A `hammer` needs `args.closeNow: 1` while the lot is still open; it is refused
with 409 when the price or leader changed since the console last looked.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Control.ControlAuction(new ControlAuctionRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
        Body = new ControlRequest { ControlId = "ctl-001", Action = ActionEnum.Pause },
    });
    // TODO: Handle 'response' of type ControlResponse
}
catch (ApiException<ControlAuctionError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[ControlAuctionRequest](src/GavelHostApi/Requests/Control/ControlAuctionRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ControlResponse](src/GavelHostApi/Models/ControlResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[ControlAuctionError](src/GavelHostApi/Errors/ControlAuctionError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiAuctionsKillResponse&gt; KillAuction(KillAuctionRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Auctioneer token only. Ends the lot as an unsold hammer so settlement voids every hold.
A repeat, or a lot that is already over, is a no-op that answers 200 with the current
state. The body must carry `confirm: "STOP"`.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Control.KillAuction(new KillAuctionRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
        Body = new ApiAuctionsKillRequest(),
    });
    // TODO: Handle 'response' of type ApiAuctionsKillResponse
}
catch (ApiException<KillAuctionError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[KillAuctionRequest](src/GavelHostApi/Requests/Control/KillAuctionRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiAuctionsKillResponse](src/GavelHostApi/Models/ApiAuctionsKillResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[KillAuctionError](src/GavelHostApi/Errors/KillAuctionError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

## Export

> Source: [Export](src/GavelHostApi/Api/Export.cs)

<details>
<summary><code>Task AdminExport(AdminExportRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. Output carries every bidder's ceiling, hold reference and bid
transcript: never publish it. Modes by query: `auction=<id>` (the hash-chained ledger
as NDJSON, last line `{head}`); `list=1` (all auction ids); `kind=payments&auction=<id>`
(settlement journal and holds); `kind=payments-global` (webhook event ids and kill
switch); `kind=roomlog&auction=<id>` (room events as NDJSON, last line `{end}`).
Secret-looking keys are replaced with `[redacted]` and webhook bodies are dropped.
Errors are `{"error": "<code>"}`.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    await client.Export.AdminExport(new AdminExportRequest { List = ListEnum._1, Kind = Kind.Payments });
}
catch (ApiException<AdminExportError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[AdminExportRequest](src/GavelHostApi/Requests/Operator/AdminExportRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: No content

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[AdminExportError](src/GavelHostApi/Errors/AdminExportError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ReplayBundle&gt; AdminReplayBundle(AdminReplayBundleRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. A self-contained bundle of the auction's ledger for replay and
verification. Query `auctionId` is required. 404 when the ledger has no entry, 409
`ledger_unverified` when the hash chain is broken, 500 `export_failed` when it cannot
be read.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Export.AdminReplayBundle(new AdminReplayBundleRequest
    {
        AuctionId = "01J9ZZ0000000000000000000A",
    });
    // TODO: Handle 'response' of type ReplayBundle
}
catch (ApiException<AdminReplayBundleError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[AdminReplayBundleRequest](src/GavelHostApi/Requests/Operator/AdminReplayBundleRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ReplayBundle](src/GavelHostApi/Models/ReplayBundle.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[AdminReplayBundleError](src/GavelHostApi/Errors/AdminReplayBundleError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task ExportEvents(ExportEventsRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Auctioneer token or operator key. One JSON object per line, in sequence order, with
personal fields removed for everyone but the operator. If the store has a gap the
connection is cut instead of ending quietly, so a short file never looks complete.
This route is served by the host directly: its errors are `{"error": "<code>"}` only.
Only an auctioneer token of that auction or the operator key opens it; any other token
(session, screen, reviewer) is 401, never 403.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    await client.Export.ExportEvents(new ExportEventsRequest { Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
}
catch (ApiException<ExportEventsError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[ExportEventsRequest](src/GavelHostApi/Requests/Export/ExportEventsRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: No content

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[ExportEventsError](src/GavelHostApi/Errors/ExportEventsError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ReplayBundle&gt; GetJudgeRoomLedger(GetJudgeRoomLedgerRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Reviewer or auctioneer token of that room. The room's hash-chained ledger as a replay
bundle with the private fields removed. The private chain and the public chain are
both checked before anything is sent: a broken chain answers 409 `ledger_unverified`
instead of a bundle that looks fine. 404 before the ledger has any entry, for an id
that is not a judge room, or when judge rooms are off.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Export.GetJudgeRoomLedger(new GetJudgeRoomLedgerRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    });
    // TODO: Handle 'response' of type ReplayBundle
}
catch (ApiException<GetJudgeRoomLedgerError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[GetJudgeRoomLedgerRequest](src/GavelHostApi/Requests/JudgeRooms/GetJudgeRoomLedgerRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ReplayBundle](src/GavelHostApi/Models/ReplayBundle.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[GetJudgeRoomLedgerError](src/GavelHostApi/Errors/GetJudgeRoomLedgerError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

## Health

> Source: [Health](src/GavelHostApi/Api/Health.cs)

<details>
<summary><code>Task&lt;Status&gt; GetHealth(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Always 200 while the process runs. Never rate limited. Answers on any HTTP method (the host matches the path only); use `GET`.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Health.GetHealth();
    // TODO: Handle 'response' of type Status
}
catch (ApiException<RawError> ex)
{
    // TODO: Handle 'ex.Error' of type RawError
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[Status](src/GavelHostApi/Models/Status.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[RawError](src/GavelHostApi/Core/ErrorResponse/RawError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;Status&gt; GetReadiness(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

200 when every migration is applied and the store answers; 503 otherwise. Never rate limited. Answers on any HTTP method (the host matches the path only); use `GET`.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Health.GetReadiness();
    // TODO: Handle 'response' of type Status
}
catch (ApiException<GetReadinessError> ex)
{
    if (ex.Error.TryGetReadyz503Error1(out var error))
    {
        // TODO: Handle 'error' of type Readyz503Error1
    }
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[Status](src/GavelHostApi/Models/Status.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[GetReadinessError](src/GavelHostApi/Errors/GetReadinessError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;VersionResponse&gt; GetVersion(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

The commit the running build was made from, or `unknown`. Never rate limited. Answers on any HTTP method (the host matches the path only); use `GET`.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Health.GetVersion();
    // TODO: Handle 'response' of type VersionResponse
}
catch (ApiException<RawError> ex)
{
    // TODO: Handle 'ex.Error' of type RawError
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[VersionResponse](src/GavelHostApi/Models/VersionResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[RawError](src/GavelHostApi/Core/ErrorResponse/RawError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;WarmupReport&gt; Warmup(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

No credential. Runs the warm-up steps in parallel within a 3 second budget; 200 when all are warm, 503 otherwise.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Health.Warmup();
    // TODO: Handle 'response' of type WarmupReport
}
catch (ApiException<WarmupError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[WarmupReport](src/GavelHostApi/Models/WarmupReport.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[WarmupError](src/GavelHostApi/Errors/WarmupError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

## Holds

> Source: [Holds](src/GavelHostApi/Api/Holds.cs)

<details>
<summary><code>Task&lt;ApiHoldsResponse1&gt; AbandonHold(AbandonHoldRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Session token of the hold's owner. Idempotent. A hold that is already authorized is
not released: it answers 409 `hold_exists`.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Holds.AbandonHold(new AbandonHoldRequest { HoldId = "hold_01" });
    // TODO: Handle 'response' of type ApiHoldsResponse1
}
catch (ApiException<AbandonHoldError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[AbandonHoldRequest](src/GavelHostApi/Requests/Holds/AbandonHoldRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiHoldsResponse1](src/GavelHostApi/Models/ApiHoldsResponse1.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[AbandonHoldError](src/GavelHostApi/Errors/AbandonHoldError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiHoldsApproveResponse&gt; ApproveHold(ApproveHoldRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Session token of the hold's owner. Another bidder's hold answers 404, exactly like an
unknown hold. When `name` is sent, the bidder is also registered in the room once the
hold is authorized (idempotent).

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Holds.ApproveHold(new ApproveHoldRequest
    {
        HoldId = "hold_01",
        Body = new ApiHoldsApproveRequest { OrderId = "ORDER-EXAMPLE", Name = "Asha" },
    });
    // TODO: Handle 'response' of type ApiHoldsApproveResponse
}
catch (ApiException<ApproveHoldError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[ApproveHoldRequest](src/GavelHostApi/Requests/Holds/ApproveHoldRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiHoldsApproveResponse](src/GavelHostApi/Models/ApiHoldsApproveResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[ApproveHoldError](src/GavelHostApi/Errors/ApproveHoldError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;CreateHoldResponse&gt; CreateHold(CreateHoldRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Session token only. The bidder is the one in the token; a body that names a bidder is
rejected. The ceiling is any whole number of cents from 100 up to the host cap (the
room's `maxCeilingCents`, setting `GAVEL_MAX_CEILING_CENTS`); the auction's preset
ceilings are suggestions only. A ceiling below 100 or above the cap answers 400
`ceiling_out_of_range`. Hold failures are `{error, message}` with the codes in
`HoldErrorCode`; authentication and state failures (`unauthorized`, `closed`) are
`{code, message}`.

<!-- FEAT-61 begin: raise a limit -->
A bidder who already has a HELD hold can raise the limit with this same route: send a
`ceilingCents` above the held one and up to the server cap. The answer is a new order
that replaces the old hold once it is approved; the old authorization is voided only
after the room has switched to the new one, so the bidder always has a hold. The same
request twice returns the same order. A ceiling that is not higher answers 409
`hold_exists`; one above the cap answers 400 `ceiling_out_of_range`; once the lot is
hammered the route answers 409 `closed`. Still held, not charged (sandbox only).

Raising is bounded (FIX-110). A bidder gets at most 5 raises per auction (abandoned
orders count too, at three times that); the sixth answers 409 `raise_limit_reached`.
A raise must add at least $1 or 5 percent of the current limit, whichever is larger;
a smaller one answers 422 `raise_too_small` before any PayPal call. The write rate
limit of the session token applies as for every other write. If a raise was approved
but the room never took it (a failed registration), asking for the same amount again
returns the same order and the approve route registers it; one that stays unregistered
for ten minutes is voided by the server, so the bidder is never held twice for long.
<!-- FEAT-61 end -->

<!-- FIX-118 begin: refuse early -->
A ceiling under the lot reserve answers 400 `ceiling_out_of_range` (the message names the
reserve), and a bidder whose limit was revoked answers 403 `ceiling_revoked`. Both are
refused before any PayPal order exists.
<!-- FIX-118 end -->

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Holds.CreateHold(new CreateHoldRequest
    {
        Body = new ApiHoldsRequest { AuctionId = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", CeilingCents = 25000 },
    });
    // TODO: Handle 'response' of type CreateHoldResponse
}
catch (ApiException<CreateHoldError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[CreateHoldRequest](src/GavelHostApi/Requests/Holds/CreateHoldRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[CreateHoldResponse](src/GavelHostApi/Models/CreateHoldResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[CreateHoldError](src/GavelHostApi/Errors/CreateHoldError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiHoldsResponse&gt; GetHold(GetHoldRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Session token of the hold's owner. Anyone else's hold answers 404.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Holds.GetHold(new GetHoldRequest { HoldId = "hold_01" });
    // TODO: Handle 'response' of type ApiHoldsResponse
}
catch (ApiException<GetHoldError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[GetHoldRequest](src/GavelHostApi/Requests/Holds/GetHoldRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiHoldsResponse](src/GavelHostApi/Models/ApiHoldsResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[GetHoldError](src/GavelHostApi/Errors/GetHoldError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

## JudgeRooms

> Source: [JudgeRooms](src/GavelHostApi/Api/JudgeRooms.cs)

<details>
<summary><code>Task&lt;ApiJudgeKeyResponse&gt; CheckJudgeKey(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Send the key in the `X-Judge-Key` header, with no body. Creates nothing; it lets a
panel say whether the key works. A wrong key is 401 `judge_key_invalid` and counts
toward a lockout of its own, separate from the room-code lockout (5 wrong keys, 15
minutes, per source address: 429 `judge_key_locked`, even with the right key; joins are
not affected). A blank key is 401 without a strike. When the host has no judge key set,
every key answers as wrong. Answers 404 when judge rooms are off.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.JudgeRooms.CheckJudgeKey();
    // TODO: Handle 'response' of type ApiJudgeKeyResponse
}
catch (ApiException<CheckJudgeKeyError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiJudgeKeyResponse](src/GavelHostApi/Models/ApiJudgeKeyResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[CheckJudgeKeyError](src/GavelHostApi/Errors/CheckJudgeKeyError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiJudgeRoomsCloseResponse&gt; CloseJudgeRoom(CloseJudgeRoomRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

The creator ends a judge room before its normal end. Send the room's auctioneer token as a
bearer token. A running lot is stopped first (an unsold hammer, as the console Stop button
does), then the room is marked ended: new joins, simulated holds and bids are refused with
410. Nothing is deleted, so the ledger, the audit trail and the receipt stay readable.
Safe to repeat: a room that is already closed answers 200 with `alreadyClosed: true`.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.JudgeRooms.CloseJudgeRoom(new CloseJudgeRoomRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    });
    // TODO: Handle 'response' of type ApiJudgeRoomsCloseResponse
}
catch (ApiException<CloseJudgeRoomError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[CloseJudgeRoomRequest](src/GavelHostApi/Requests/JudgeRooms/CloseJudgeRoomRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiJudgeRoomsCloseResponse](src/GavelHostApi/Models/ApiJudgeRoomsCloseResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[CloseJudgeRoomError](src/GavelHostApi/Errors/CloseJudgeRoomError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;JudgeRoom&gt; CreateJudgeRoom(CreateJudgeRoomRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

No credential needed. Creates a short sandbox auction (10 minute lot, small ceilings)
that ends after 30 minutes. The creator gets auctioneer, screen and reviewer tokens for
that room only; no operator route opens. Answers 404 when judge rooms are off.

With the optional `X-Judge-Key` header the request is judged by the key alone: the
public limits do not apply, the room does not use a public slot, and a wrong key is
401 `judge_key_invalid` (it never falls back to the public path). An empty header is
401 `judge_key_invalid` without a strike. Wrong keys have a lockout of their own, separate from the room-code lockout:
5 wrong keys, 15 minutes, per source address (429 `judge_key_locked`); it has no effect
on joins. The response then carries `unlocked: true`.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.JudgeRooms.CreateJudgeRoom(new CreateJudgeRoomRequest
    {
        Body = new ApiJudgeRoomsRequest { Title = "Sandbox demo lot" },
    });
    // TODO: Handle 'response' of type JudgeRoom
}
catch (ApiException<CreateJudgeRoomError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[CreateJudgeRoomRequest](src/GavelHostApi/Requests/JudgeRooms/CreateJudgeRoomRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[JudgeRoom](src/GavelHostApi/Models/JudgeRoom.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[CreateJudgeRoomError](src/GavelHostApi/Errors/CreateJudgeRoomError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiJudgeRoomsSimHoldResponse&gt; CreateSimulatedHold(CreateSimulatedHoldRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Session token of a bidder in that judge room. Writes an already-authorized hold with
no PayPal call and puts the bidder in the room, so the whole path can be tried without
a PayPal login. The ceiling is any whole number of cents from 100 up to the room's
ceiling cap (the top preset); the presets are only quick picks, and a value outside the
range is 400 `bad_message`. A ceiling under the lot reserve is also 400 `bad_message`
(the message names the reserve), and a bidder whose limit was revoked is 403
`ceiling_revoked`; both are refused before any hold is written. Any other auction
answers 404. Answers 404 when simulated holds are off. A larger ceiling for a bidder who
already has a hold is a raise, bounded like `POST /api/holds`: at most 5 raises per
bidder (409 `raise_limit_reached`) and each at least $1 or 5 percent more than the
current limit (422 `raise_too_small`).

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.JudgeRooms.CreateSimulatedHold(new CreateSimulatedHoldRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
        Body = new ApiJudgeRoomsSimHoldRequest { CeilingCents = 5000, Name = "Asha" },
    });
    // TODO: Handle 'response' of type ApiJudgeRoomsSimHoldResponse
}
catch (ApiException<CreateSimulatedHoldError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[CreateSimulatedHoldRequest](src/GavelHostApi/Requests/JudgeRooms/CreateSimulatedHoldRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiJudgeRoomsSimHoldResponse](src/GavelHostApi/Models/ApiJudgeRoomsSimHoldResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[CreateSimulatedHoldError](src/GavelHostApi/Errors/CreateSimulatedHoldError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiJudgeCapabilitiesResponse&gt; GetJudgeCapabilities(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

No credential. Tells a client whether it can create a room right now.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.JudgeRooms.GetJudgeCapabilities();
    // TODO: Handle 'response' of type ApiJudgeCapabilitiesResponse
}
catch (ApiException<GetJudgeCapabilitiesError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiJudgeCapabilitiesResponse](src/GavelHostApi/Models/ApiJudgeCapabilitiesResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[GetJudgeCapabilitiesError](src/GavelHostApi/Errors/GetJudgeCapabilitiesError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ReplayBundle&gt; GetJudgeRoomLedger(GetJudgeRoomLedgerRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Reviewer or auctioneer token of that room. The room's hash-chained ledger as a replay
bundle with the private fields removed. The private chain and the public chain are
both checked before anything is sent: a broken chain answers 409 `ledger_unverified`
instead of a bundle that looks fine. 404 before the ledger has any entry, for an id
that is not a judge room, or when judge rooms are off.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.JudgeRooms.GetJudgeRoomLedger(new GetJudgeRoomLedgerRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    });
    // TODO: Handle 'response' of type ReplayBundle
}
catch (ApiException<GetJudgeRoomLedgerError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[GetJudgeRoomLedgerRequest](src/GavelHostApi/Requests/JudgeRooms/GetJudgeRoomLedgerRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ReplayBundle](src/GavelHostApi/Models/ReplayBundle.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[GetJudgeRoomLedgerError](src/GavelHostApi/Errors/GetJudgeRoomLedgerError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiJudgeJoinResponse&gt; JoinJudgeRoom(JoinJudgeRoomRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

No credential. A bidder joins a judge room with its 6 character code and a display
name and gets a session token. Only judge rooms: the code of any other auction answers
exactly like an unknown code (404). Wrong codes are counted; 5 wrong codes lock a
source address out for 15 minutes (429 `judge_join_locked`). At most 20 bidders join
one room (429 `judge_room_full`). An ended room answers 410.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.JudgeRooms.JoinJudgeRoom(new JoinJudgeRoomRequest
    {
        Body = new ApiJudgeJoinRequest { Code = "gvl-k7m 2qx", DisplayName = "Asha" },
    });
    // TODO: Handle 'response' of type ApiJudgeJoinResponse
}
catch (ApiException<JoinJudgeRoomError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[JoinJudgeRoomRequest](src/GavelHostApi/Requests/JudgeRooms/JoinJudgeRoomRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiJudgeJoinResponse](src/GavelHostApi/Models/ApiJudgeJoinResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[JoinJudgeRoomError](src/GavelHostApi/Errors/JoinJudgeRoomError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiJudgeKeysResponse&gt; ListJudgeKeys(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only (`X-Admin-Key`). Lists every judge key by id with its label, limits and
state. The secret and its hash are never returned. A judge key on this route is 401.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.JudgeRooms.ListJudgeKeys();
    // TODO: Handle 'response' of type ApiJudgeKeysResponse
}
catch (ApiException<ListJudgeKeysError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiJudgeKeysResponse](src/GavelHostApi/Models/ApiJudgeKeysResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[ListJudgeKeysError](src/GavelHostApi/Errors/ListJudgeKeysError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiJudgePauseResponse&gt; PauseJudgeRooms(PauseJudgeRoomsRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. A global kill switch for the create route; the flag survives a restart.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.JudgeRooms.PauseJudgeRooms(new PauseJudgeRoomsRequest
    {
        Body = new ApiJudgePauseRequest { Paused = true },
    });
    // TODO: Handle 'response' of type ApiJudgePauseResponse
}
catch (ApiException<PauseJudgeRoomsError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[PauseJudgeRoomsRequest](src/GavelHostApi/Requests/JudgeRooms/PauseJudgeRoomsRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiJudgePauseResponse](src/GavelHostApi/Models/ApiJudgePauseResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[PauseJudgeRoomsError](src/GavelHostApi/Errors/PauseJudgeRoomsError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiJudgeRoomsBidsResponse&gt; PlaceJudgeBid(PlaceJudgeBidRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Bid with plain HTTP, for curl and generated clients that cannot open the WebSocket (the
socket needs a browser `Origin`; this route does not, and the socket rules are
unchanged). Send the session token from `POST /api/judge/join` as a bearer token, after
the bidder has a hold (`POST /api/judge/rooms/{id}/sim-hold`). The bid takes the same
path as a socket bid: the per-bidder bid limit, the registered check and the auction
engine all apply. `amount` is whole cents. `mid` is optional; send the same `mid` again
to retry safely, the room answers with the original result and records nothing twice.

A bid the engine refuses (too low, over your ceiling, lot closed) is 409 with
`accepted: false` and a `reason`. Sending a `mid` again with a different `amount` is 409
`conflict` (`{error, code, message}`). Bids sent too fast are 429 `rate_limited` with
`Retry-After`. When the room cannot take the bid (`auction_full`, `store_unavailable`,
`room_full`) the answer is 503. Only session tokens work here, and only for judge
rooms: any other auction answers 404. A judge key is not needed on this route.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.JudgeRooms.PlaceJudgeBid(new PlaceJudgeBidRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
        Body = new ApiJudgeRoomsBidsRequest { Amount = 1500 },
    });
    // TODO: Handle 'response' of type ApiJudgeRoomsBidsResponse
}
catch (ApiException<PlaceJudgeBidError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[PlaceJudgeBidRequest](src/GavelHostApi/Requests/JudgeRooms/PlaceJudgeBidRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiJudgeRoomsBidsResponse](src/GavelHostApi/Models/ApiJudgeRoomsBidsResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[PlaceJudgeBidError](src/GavelHostApi/Errors/PlaceJudgeBidError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiJudgeKeysRevokeResponse&gt; RevokeJudgeKey(RevokeJudgeKeyRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only (`X-Admin-Key`). The key is refused from now on (401 `judge_key_revoked`)
and stays revoked after a restart. Rooms it already opened run until they end. A judge
key on this route is 401.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.JudgeRooms.RevokeJudgeKey(new RevokeJudgeKeyRequest { KeyId = "some example string" });
    // TODO: Handle 'response' of type ApiJudgeKeysRevokeResponse
}
catch (ApiException<RevokeJudgeKeyError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[RevokeJudgeKeyRequest](src/GavelHostApi/Requests/JudgeRooms/RevokeJudgeKeyRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiJudgeKeysRevokeResponse](src/GavelHostApi/Models/ApiJudgeKeysRevokeResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[RevokeJudgeKeyError](src/GavelHostApi/Errors/RevokeJudgeKeyError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

## Operator

> Source: [Operator](src/GavelHostApi/Api/Operator.cs)

<details>
<summary><code>Task AdminExport(AdminExportRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. Output carries every bidder's ceiling, hold reference and bid
transcript: never publish it. Modes by query: `auction=<id>` (the hash-chained ledger
as NDJSON, last line `{head}`); `list=1` (all auction ids); `kind=payments&auction=<id>`
(settlement journal and holds); `kind=payments-global` (webhook event ids and kill
switch); `kind=roomlog&auction=<id>` (room events as NDJSON, last line `{end}`).
Secret-looking keys are replaced with `[redacted]` and webhook bodies are dropped.
Errors are `{"error": "<code>"}`.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    await client.Operator.AdminExport(new AdminExportRequest { List = ListEnum._1, Kind = Kind.Payments });
}
catch (ApiException<AdminExportError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[AdminExportRequest](src/GavelHostApi/Requests/Operator/AdminExportRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: No content

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[AdminExportError](src/GavelHostApi/Errors/AdminExportError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ReplayBundle&gt; AdminReplayBundle(AdminReplayBundleRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. A self-contained bundle of the auction's ledger for replay and
verification. Query `auctionId` is required. 404 when the ledger has no entry, 409
`ledger_unverified` when the hash chain is broken, 500 `export_failed` when it cannot
be read.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Operator.AdminReplayBundle(new AdminReplayBundleRequest
    {
        AuctionId = "01J9ZZ0000000000000000000A",
    });
    // TODO: Handle 'response' of type ReplayBundle
}
catch (ApiException<AdminReplayBundleError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[AdminReplayBundleRequest](src/GavelHostApi/Requests/Operator/AdminReplayBundleRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ReplayBundle](src/GavelHostApi/Models/ReplayBundle.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[AdminReplayBundleError](src/GavelHostApi/Errors/AdminReplayBundleError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;object&gt; GetMetrics(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only: this route is not public. Own limit of 60 requests per minute on top of
the host-wide limit.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Operator.GetMetrics();
    // TODO: Handle 'response' of type object
}
catch (ApiException<GetMetricsError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>object</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[GetMetricsError](src/GavelHostApi/Errors/GetMetricsError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;string&gt; GetMetricsPrometheus(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Operator.GetMetricsPrometheus();
    // TODO: Handle 'response' of type string
}
catch (ApiException<GetMetricsPrometheusError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>string</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[GetMetricsPrometheusError](src/GavelHostApi/Errors/GetMetricsPrometheusError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;OpsSummaryResponse&gt; GetOpsSummary(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. Recent logs, settlement sagas, PayPal webhook outcomes and metrics.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Operator.GetOpsSummary();
    // TODO: Handle 'response' of type OpsSummaryResponse
}
catch (ApiException<GetOpsSummaryError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[OpsSummaryResponse](src/GavelHostApi/Models/OpsSummaryResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[GetOpsSummaryError](src/GavelHostApi/Errors/GetOpsSummaryError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiJudgeKeysResponse&gt; ListJudgeKeys(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only (`X-Admin-Key`). Lists every judge key by id with its label, limits and
state. The secret and its hash are never returned. A judge key on this route is 401.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Operator.ListJudgeKeys();
    // TODO: Handle 'response' of type ApiJudgeKeysResponse
}
catch (ApiException<ListJudgeKeysError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiJudgeKeysResponse](src/GavelHostApi/Models/ApiJudgeKeysResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[ListJudgeKeysError](src/GavelHostApi/Errors/ListJudgeKeysError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;OpsRoomsResponse&gt; ListOpsRooms(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Operator.ListOpsRooms();
    // TODO: Handle 'response' of type OpsRoomsResponse
}
catch (ApiException<ListOpsRoomsError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[OpsRoomsResponse](src/GavelHostApi/Models/OpsRoomsResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[ListOpsRoomsError](src/GavelHostApi/Errors/ListOpsRoomsError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;OpsAuctionsReleaseReviewResponse&gt; OpsReleaseReview(OpsReleaseReviewRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. Releases the fallback candidates' holds of a settlement in review.
409 with `busy`, `no_settlement` or `not_in_review`.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Operator.OpsReleaseReview(new OpsReleaseReviewRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    });
    // TODO: Handle 'response' of type OpsAuctionsReleaseReviewResponse
}
catch (ApiException<OpsReleaseReviewError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[OpsReleaseReviewRequest](src/GavelHostApi/Requests/Operator/OpsReleaseReviewRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[OpsAuctionsReleaseReviewResponse](src/GavelHostApi/Models/OpsAuctionsReleaseReviewResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[OpsReleaseReviewError](src/GavelHostApi/Errors/OpsReleaseReviewError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;OpsAuctionsVoidAllResponse&gt; OpsVoidAll(OpsVoidAllRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. For example while the kill switch keeps a capture waiting. Audited with
the actor `admin`. 409 `busy` while a settlement run holds the lease, 409
`no_settlement` before the lot was hammered.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Operator.OpsVoidAll(new OpsVoidAllRequest { Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
    // TODO: Handle 'response' of type OpsAuctionsVoidAllResponse
}
catch (ApiException<OpsVoidAllError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[OpsVoidAllRequest](src/GavelHostApi/Requests/Operator/OpsVoidAllRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[OpsAuctionsVoidAllResponse](src/GavelHostApi/Models/OpsAuctionsVoidAllResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[OpsVoidAllError](src/GavelHostApi/Errors/OpsVoidAllError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiJudgePauseResponse&gt; PauseJudgeRooms(PauseJudgeRoomsRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. A global kill switch for the create route; the flag survives a restart.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Operator.PauseJudgeRooms(new PauseJudgeRoomsRequest
    {
        Body = new ApiJudgePauseRequest { Paused = true },
    });
    // TODO: Handle 'response' of type ApiJudgePauseResponse
}
catch (ApiException<PauseJudgeRoomsError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[PauseJudgeRoomsRequest](src/GavelHostApi/Requests/JudgeRooms/PauseJudgeRoomsRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiJudgePauseResponse](src/GavelHostApi/Models/ApiJudgePauseResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[PauseJudgeRoomsError](src/GavelHostApi/Errors/PauseJudgeRoomsError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiJudgeKeysRevokeResponse&gt; RevokeJudgeKey(RevokeJudgeKeyRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only (`X-Admin-Key`). The key is refused from now on (401 `judge_key_revoked`)
and stays revoked after a restart. Rooms it already opened run until they end. A judge
key on this route is 401.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Operator.RevokeJudgeKey(new RevokeJudgeKeyRequest { KeyId = "some example string" });
    // TODO: Handle 'response' of type ApiJudgeKeysRevokeResponse
}
catch (ApiException<RevokeJudgeKeyError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[RevokeJudgeKeyRequest](src/GavelHostApi/Requests/JudgeRooms/RevokeJudgeKeyRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiJudgeKeysRevokeResponse](src/GavelHostApi/Models/ApiJudgeKeysRevokeResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[RevokeJudgeKeyError](src/GavelHostApi/Errors/RevokeJudgeKeyError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

## Read

> Source: [Read](src/GavelHostApi/Api/Read.cs)

<details>
<summary><code>Task&lt;StateFrame&gt; GetSnapshot(GetSnapshotRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

The same snapshot the WebSocket sends in a `state` frame, filtered by role: a bidder
sees only their own ceiling and hold, a screen sees no private fields, the auctioneer
sees the full audit rows. A reviewer token gets the screen's view.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Read.GetSnapshot(new GetSnapshotRequest { Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
    // TODO: Handle 'response' of type StateFrame
}
catch (ApiException<GetSnapshotError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[GetSnapshotRequest](src/GavelHostApi/Requests/Read/GetSnapshotRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[StateFrame](src/GavelHostApi/Models/StateFrame.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[GetSnapshotError](src/GavelHostApi/Errors/GetSnapshotError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiAuctionsEventsResponse&gt; ListEvents(ListEventsRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Auctioneer, screen or reviewer token (a reviewer sees what a screen sees). Events after sequence `after`, at most `limit`. A screen
sees full rows only for public event types; every other event is a bare `{seq}` so the
log stays whole. Ceilings, transcripts, hold references and the auctioneer subject are
never returned. Pass `next` back as `after` to continue.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Read.ListEvents(new ListEventsRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
        After = 0,
        Limit = 100,
    });
    // TODO: Handle 'response' of type ApiAuctionsEventsResponse
}
catch (ApiException<ListEventsError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[ListEventsRequest](src/GavelHostApi/Requests/Read/ListEventsRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiAuctionsEventsResponse](src/GavelHostApi/Models/ApiAuctionsEventsResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[ListEventsError](src/GavelHostApi/Errors/ListEventsError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

## Receipts

> Source: [Receipts](src/GavelHostApi/Api/Receipts.cs)

<details>
<summary><code>Task&lt;ApiAuctionsReceiptLinkResponse&gt; CreateReceiptLink(CreateReceiptLinkRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Session token only. Returns a receipt token (valid 4 hours) that opens exactly one
read-only route, `GET /api/auctions/{id}/receipt`, for this bidder.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Receipts.CreateReceiptLink(new CreateReceiptLinkRequest
    {
        Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    });
    // TODO: Handle 'response' of type ApiAuctionsReceiptLinkResponse
}
catch (ApiException<CreateReceiptLinkError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[CreateReceiptLinkRequest](src/GavelHostApi/Requests/Receipts/CreateReceiptLinkRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiAuctionsReceiptLinkResponse](src/GavelHostApi/Models/ApiAuctionsReceiptLinkResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[CreateReceiptLinkError](src/GavelHostApi/Errors/CreateReceiptLinkError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>Task&lt;ApiAuctionsReceiptResponse&gt; GetReceipt(GetReceiptRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default);</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Receipt token only. A cut-down snapshot: the lot, the hammer outcome, the viewer's own
roster row and own hold. The winner keeps a paddle but loses the name, every other
bidder is dropped, and the ceiling, the join code and the audit rows are removed.

</dd>
</dl>

### Usage

<dl>
<dd>

```csharp
try
{
    var response = await client.Receipts.GetReceipt(new GetReceiptRequest { Id = "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
    // TODO: Handle 'response' of type ApiAuctionsReceiptResponse
}
catch (ApiException<GetReceiptError> ex)
{
    if (ex.Error.TryGetError5(out var error))
    {
        // TODO: Handle 'error' of type Error5
    }
}
```

</dd>
</dl>

### Request

<dl>
<dd>

<code>[GetReceiptRequest](src/GavelHostApi/Requests/Receipts/GetReceiptRequest.cs)</code>

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ApiAuctionsReceiptResponse](src/GavelHostApi/Models/ApiAuctionsReceiptResponse.cs)</code>

**OnError**: <code>[ApiException](src/GavelHostApi/Core/Exceptions/ApiException.cs)&lt;[GetReceiptError](src/GavelHostApi/Errors/GetReceiptError.cs)&gt;</code>

</dd>
</dl>

</dd>
</dl>

</details>

