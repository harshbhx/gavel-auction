# Raw Reference

**Raw** endpoints, reached through `with_raw_response`, return `ApiResult[T, E]` and never raise for an API error. For the parsed endpoints, see [API Reference](api-reference.md).

> Source: [GavelHostApiClient](gavel_host_api/client.py)

## Auctions

> Source: [Auctions](gavel_host_api/apis/auctions.py)

<details>
<summary><code>def create_auction(body: CreateAuctionRequest | CreateAuctionRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[CreateAuctionResponse, CreateAuctionErrorBody]</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. Creates the auction, reserves a 6 character join code, and returns links
for the auctioneer console and the projector screen. The tokens are inside the links
(fragment `#token=`), valid 12 hours.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
result = client.auctions.with_raw_response.create_auction(
    CreateAuctionRequest(
        title="Charity quilt",
        config=AuctionConfig(
            mode=Mode.ENGLISH,
            reserve=10000,
            min_increment=500,
            end_ts=1767225600000,
            soft_close_window_ms=30000,
            soft_close_extension_ms=30000,
            max_extensions=5,
            ceiling_presets=[10000, 25000, 50000],
            confirm_confidence_threshold=0.85,
        ),
        fundraiser_goal_cents=500000,
    ),
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type CreateAuctionResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CreateAuctionErrorBody
```

**Async**

```python
result = await async_client.auctions.with_raw_response.create_auction(
    CreateAuctionRequest(
        title="Charity quilt",
        config=AuctionConfig(
            mode=Mode.ENGLISH,
            reserve=10000,
            min_increment=500,
            end_ts=1767225600000,
            soft_close_window_ms=30000,
            soft_close_extension_ms=30000,
            max_extensions=5,
            ceiling_presets=[10000, 25000, 50000],
            confirm_confidence_threshold=0.85,
        ),
        fundraiser_goal_cents=500000,
    ),
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type CreateAuctionResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CreateAuctionErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[CreateAuctionRequest](gavel_host_api/models/create_auction_request.py) \| [CreateAuctionRequestDict](gavel_host_api/models/create_auction_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[CreateAuctionResponse](gavel_host_api/models/create_auction_response.py), [CreateAuctionErrorBody](gavel_host_api/errors/create_auction_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[CreateAuctionResponse](gavel_host_api/models/create_auction_response.py)</code> -- Auction created.

**On `Failure`**: `error` is <code>[CreateAuctionErrorBody](gavel_host_api/errors/create_auction_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 413, 415, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def get_auction(id_: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[AuctionPublic, GetAuctionErrorBody]</code></summary>

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

**Sync**

```python
result = client.auctions.with_raw_response.get_auction("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type AuctionPublic
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetAuctionErrorBody
```

**Async**

```python
result = await async_client.auctions.with_raw_response.get_auction("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type AuctionPublic
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetAuctionErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id, or its 6 character join code. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[AuctionPublic](gavel_host_api/models/auction_public.py), [GetAuctionErrorBody](gavel_host_api/errors/get_auction_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[AuctionPublic](gavel_host_api/models/auction_public.py)</code> -- The auction.

**On `Failure`**: `error` is <code>[GetAuctionErrorBody](gavel_host_api/errors/get_auction_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 404, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def revoke_all_auctioneer_tokens(id_: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[Revoked, RevokeAllAuctioneerTokensErrorBody]</code></summary>

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

**Sync**

```python
result = client.auctions.with_raw_response.revoke_all_auctioneer_tokens("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Revoked
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RevokeAllAuctioneerTokensErrorBody
```

**Async**

```python
result = await async_client.auctions.with_raw_response.revoke_all_auctioneer_tokens("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Revoked
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RevokeAllAuctioneerTokensErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[Revoked](gavel_host_api/models/revoked.py), [RevokeAllAuctioneerTokensErrorBody](gavel_host_api/errors/revoke_all_auctioneer_tokens_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[Revoked](gavel_host_api/models/revoked.py)</code> -- Revoked.

**On `Failure`**: `error` is <code>[RevokeAllAuctioneerTokensErrorBody](gavel_host_api/errors/revoke_all_auctioneer_tokens_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 404, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def revoke_auctioneer_token(id_: str, body: ApiAuctionsAuctioneerRevokeRequest | ApiAuctionsAuctioneerRevokeRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[Revoked, RevokeAuctioneerTokenErrorBody]</code></summary>

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

**Sync**

```python
result = client.auctions.with_raw_response.revoke_auctioneer_token(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ApiAuctionsAuctioneerRevokeRequest(jti="01JC5ZQ0A1B2C3D4E5F6G7H8J9")
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Revoked
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RevokeAuctioneerTokenErrorBody
```

**Async**

```python
result = await async_client.auctions.with_raw_response.revoke_auctioneer_token(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ApiAuctionsAuctioneerRevokeRequest(jti="01JC5ZQ0A1B2C3D4E5F6G7H8J9")
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Revoked
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RevokeAuctioneerTokenErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>body</code> | <code>[ApiAuctionsAuctioneerRevokeRequest](gavel_host_api/models/api_auctions_auctioneer_revoke_request.py) \| [ApiAuctionsAuctioneerRevokeRequestDict](gavel_host_api/models/api_auctions_auctioneer_revoke_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[Revoked](gavel_host_api/models/revoked.py), [RevokeAuctioneerTokenErrorBody](gavel_host_api/errors/revoke_auctioneer_token_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[Revoked](gavel_host_api/models/revoked.py)</code> -- Revoked.

**On `Failure`**: `error` is <code>[RevokeAuctioneerTokenErrorBody](gavel_host_api/errors/revoke_auctioneer_token_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 404, 413, 415, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def rotate_auctioneer_token(id_: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiAuctionsAuctioneerRotateResponse, RotateAuctioneerTokenErrorBody]</code></summary>

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

**Sync**

```python
result = client.auctions.with_raw_response.rotate_auctioneer_token("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiAuctionsAuctioneerRotateResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RotateAuctioneerTokenErrorBody
```

**Async**

```python
result = await async_client.auctions.with_raw_response.rotate_auctioneer_token("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiAuctionsAuctioneerRotateResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RotateAuctioneerTokenErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiAuctionsAuctioneerRotateResponse](gavel_host_api/models/api_auctions_auctioneer_rotate_response.py), [RotateAuctioneerTokenErrorBody](gavel_host_api/errors/rotate_auctioneer_token_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiAuctionsAuctioneerRotateResponse](gavel_host_api/models/api_auctions_auctioneer_rotate_response.py)</code> -- New auctioneer link.

**On `Failure`**: `error` is <code>[RotateAuctioneerTokenErrorBody](gavel_host_api/errors/rotate_auctioneer_token_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 404, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

## BiddingAccess

> Source: [BiddingAccess](gavel_host_api/apis/bidding_access.py)

<details>
<summary><code>def create_invites(id_: str, *, body: ApiAuctionsInvitesRequest | ApiAuctionsInvitesRequestDict | None = None, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiAuctionsInvitesResponse, CreateInvitesErrorBody]</code></summary>

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

**Sync**

```python
result = client.bidding_access.with_raw_response.create_invites(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", body=ApiAuctionsInvitesRequest(count=2)
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiAuctionsInvitesResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CreateInvitesErrorBody
```

**Async**

```python
result = await async_client.bidding_access.with_raw_response.create_invites(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", body=ApiAuctionsInvitesRequest(count=2)
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiAuctionsInvitesResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CreateInvitesErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>body</code> | <code>[ApiAuctionsInvitesRequest](gavel_host_api/models/api_auctions_invites_request.py) \| [ApiAuctionsInvitesRequestDict](gavel_host_api/models/api_auctions_invites_request.py) \| None</code> | The request body.<br>**Default**: <code>None</code> |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiAuctionsInvitesResponse](gavel_host_api/models/api_auctions_invites_response.py), [CreateInvitesErrorBody](gavel_host_api/errors/create_invites_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiAuctionsInvitesResponse](gavel_host_api/models/api_auctions_invites_response.py)</code> -- Invites minted.

**On `Failure`**: `error` is <code>[CreateInvitesErrorBody](gavel_host_api/errors/create_invites_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 403, 404, 413, 415, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def join_auction(id_: str, body: ApiAuctionsJoinRequest | ApiAuctionsJoinRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[JoinResponse, JoinAuctionErrorBody]</code></summary>

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

**Sync**

```python
result = client.bidding_access.with_raw_response.join_auction(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ApiAuctionsJoinRequest(invite="INVITE_TOKEN")
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type JoinResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type JoinAuctionErrorBody
```

**Async**

```python
result = await async_client.bidding_access.with_raw_response.join_auction(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ApiAuctionsJoinRequest(invite="INVITE_TOKEN")
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type JoinResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type JoinAuctionErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id, or its 6 character join code. |
| <code>body</code> | <code>[ApiAuctionsJoinRequest](gavel_host_api/models/api_auctions_join_request.py) \| [ApiAuctionsJoinRequestDict](gavel_host_api/models/api_auctions_join_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[JoinResponse](gavel_host_api/models/join_response.py), [JoinAuctionErrorBody](gavel_host_api/errors/join_auction_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[JoinResponse](gavel_host_api/models/join_response.py)</code> -- Session created.

**On `Failure`**: `error` is <code>[JoinAuctionErrorBody](gavel_host_api/errors/join_auction_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 404, 409, 413, 415, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def reissue_invite(id_: str, bidder_id: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[Invite, ReissueInviteErrorBody]</code></summary>

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

**Sync**

```python
result = client.bidding_access.with_raw_response.reissue_invite(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", "01J9ZZ0000000000000000000B"
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Invite
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ReissueInviteErrorBody
```

**Async**

```python
result = await async_client.bidding_access.with_raw_response.reissue_invite(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", "01J9ZZ0000000000000000000B"
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Invite
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ReissueInviteErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>bidder_id</code> | <code>str</code> | Id of the registered bidder to re-invite. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[Invite](gavel_host_api/models/invite.py), [ReissueInviteErrorBody](gavel_host_api/errors/reissue_invite_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[Invite](gavel_host_api/models/invite.py)</code> -- New invite.

**On `Failure`**: `error` is <code>[ReissueInviteErrorBody](gavel_host_api/errors/reissue_invite_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 403, 404, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

## Control

> Source: [Control](gavel_host_api/apis/control.py)

<details>
<summary><code>def control_auction(id_: str, body: ControlRequest | ControlRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ControlResponse, ControlAuctionErrorBody]</code></summary>

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

**Sync**

```python
result = client.control.with_raw_response.control_auction(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ControlRequest(control_id="ctl-001", action=Action.PAUSE)
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ControlResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ControlAuctionErrorBody
```

**Async**

```python
result = await async_client.control.with_raw_response.control_auction(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ControlRequest(control_id="ctl-001", action=Action.PAUSE)
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ControlResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ControlAuctionErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>body</code> | <code>[ControlRequest](gavel_host_api/models/control_request.py) \| [ControlRequestDict](gavel_host_api/models/control_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ControlResponse](gavel_host_api/models/control_response.py), [ControlAuctionErrorBody](gavel_host_api/errors/control_auction_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ControlResponse](gavel_host_api/models/control_response.py)</code> -- The control was applied.

**On `Failure`**: `error` is <code>[ControlAuctionErrorBody](gavel_host_api/errors/control_auction_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 403, 404, 409, 413, 415, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def kill_auction(id_: str, body: ApiAuctionsKillRequest | ApiAuctionsKillRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiAuctionsKillResponse, KillAuctionErrorBody]</code></summary>

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

**Sync**

```python
result = client.control.with_raw_response.kill_auction("01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ApiAuctionsKillRequest())
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiAuctionsKillResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type KillAuctionErrorBody
```

**Async**

```python
result = await async_client.control.with_raw_response.kill_auction(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ApiAuctionsKillRequest()
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiAuctionsKillResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type KillAuctionErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>body</code> | <code>[ApiAuctionsKillRequest](gavel_host_api/models/api_auctions_kill_request.py) \| [ApiAuctionsKillRequestDict](gavel_host_api/models/api_auctions_kill_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiAuctionsKillResponse](gavel_host_api/models/api_auctions_kill_response.py), [KillAuctionErrorBody](gavel_host_api/errors/kill_auction_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiAuctionsKillResponse](gavel_host_api/models/api_auctions_kill_response.py)</code> -- The lot is stopped.

**On `Failure`**: `error` is <code>[KillAuctionErrorBody](gavel_host_api/errors/kill_auction_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 403, 404, 413, 415, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

## Export

> Source: [Export](gavel_host_api/apis/export.py)

<details>
<summary><code>def admin_export(*, auction: str | None = None, list_: ListOrStr | None = None, kind: KindOrStr | None = None, request_options: RequestOptionsOrDict | None = None) -> ApiResult[None, AdminExportErrorBody]</code></summary>

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

**Sync**

```python
result = client.export.with_raw_response.admin_export(list_=List._1, kind=Kind.PAYMENTS)
match result:
    case Success():
        ...  # 2xx, no content
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type AdminExportErrorBody
```

**Async**

```python
result = await async_client.export.with_raw_response.admin_export(list_=List._1, kind=Kind.PAYMENTS)
match result:
    case Success():
        ...  # 2xx, no content
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type AdminExportErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>auction</code> | <code>str \| None</code> | Auction id (`auctionId` is accepted as an alias).<br>**Default**: <code>None</code> |
| <code>list_</code> | <code>[ListOrStr](gavel_host_api/models/enums/list.py) \| None</code> | Send `1` to list every auction id instead of exporting one auction.<br>**Default**: <code>None</code> |
| <code>kind</code> | <code>[KindOrStr](gavel_host_api/models/enums/kind.py) \| None</code> | Which export to return. Without it, `auction` returns the ledger.<br>**Default**: <code>None</code> |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;None, [AdminExportErrorBody](gavel_host_api/errors/admin_export_error.py)&#93;</code>

**On `Success`**: the 2xx carries no content; `payload` is <code>None</code>

**On `Failure`**: `error` is <code>[AdminExportErrorBody](gavel_host_api/errors/admin_export_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 404, 405, 429, 500, 501 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def admin_replay_bundle(auction_id: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[Any, AdminReplayBundleErrorBody]</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. A self-contained bundle of the auction's ledger for replay and
verification. Query `auctionId` is required. 409 when the hash chain is broken.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
result = client.export.with_raw_response.admin_replay_bundle("01J9ZZ0000000000000000000A")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Any
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type AdminReplayBundleErrorBody
```

**Async**

```python
result = await async_client.export.with_raw_response.admin_replay_bundle("01J9ZZ0000000000000000000A")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Any
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type AdminReplayBundleErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>auction_id</code> | <code>str</code> | Id of the auction to bundle. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;Any, [AdminReplayBundleErrorBody](gavel_host_api/errors/admin_replay_bundle_error.py)&#93;</code>

**On `Success`**: `payload` is <code>Any</code> -- The bundle (format defined in `packages/shared/src/replay-bundle.ts`).

**On `Failure`**: `error` is <code>[AdminReplayBundleErrorBody](gavel_host_api/errors/admin_replay_bundle_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 404, 405, 409, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def export_events(id_: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[None, ExportEventsErrorBody]</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Auctioneer token or operator key. One JSON object per line, in sequence order, with
personal fields removed for everyone but the operator. If the store has a gap the
connection is cut instead of ending quietly, so a short file never looks complete.
This route is served by the host directly: its errors are `{"error": "<code>"}` only.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
result = client.export.with_raw_response.export_events("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success():
        ...  # 2xx, no content
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ExportEventsErrorBody
```

**Async**

```python
result = await async_client.export.with_raw_response.export_events("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success():
        ...  # 2xx, no content
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ExportEventsErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;None, [ExportEventsErrorBody](gavel_host_api/errors/export_events_error.py)&#93;</code>

**On `Success`**: the 2xx carries no content; `payload` is <code>None</code>

**On `Failure`**: `error` is <code>[ExportEventsErrorBody](gavel_host_api/errors/export_events_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 403, 404, 405, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def get_judge_room_ledger(id_: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ReplayBundle, GetJudgeRoomLedgerErrorBody]</code></summary>

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

**Sync**

```python
result = client.export.with_raw_response.get_judge_room_ledger("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ReplayBundle
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetJudgeRoomLedgerErrorBody
```

**Async**

```python
result = await async_client.export.with_raw_response.get_judge_room_ledger("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ReplayBundle
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetJudgeRoomLedgerErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ReplayBundle](gavel_host_api/models/replay_bundle.py), [GetJudgeRoomLedgerErrorBody](gavel_host_api/errors/get_judge_room_ledger_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ReplayBundle](gavel_host_api/models/replay_bundle.py)</code> -- The bundle.

**On `Failure`**: `error` is <code>[GetJudgeRoomLedgerErrorBody](gavel_host_api/errors/get_judge_room_ledger_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 404, 409, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

## Health

> Source: [Health](gavel_host_api/apis/health.py)

<details>
<summary><code>def get_health(*, request_options: RequestOptionsOrDict | None = None) -> ApiResult[Status, RawError]</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Always 200 while the process runs. Never rate limited.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
result = client.health.with_raw_response.get_health()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Status
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RawError
```

**Async**

```python
result = await async_client.health.with_raw_response.get_health()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Status
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RawError
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[Status](gavel_host_api/models/status.py), [RawError](gavel_host_api/core/results.py)&#93;</code>

**On `Success`**: `payload` is <code>[Status](gavel_host_api/models/status.py)</code> -- Alive.

**On `Failure`**: `error` is <code>[RawError](gavel_host_api/core/results.py)</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def get_readiness(*, request_options: RequestOptionsOrDict | None = None) -> ApiResult[Status, GetReadinessErrorBody]</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

200 when every migration is applied and the store answers; 503 otherwise. Never rate limited.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
result = client.health.with_raw_response.get_readiness()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Status
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetReadinessErrorBody
```

**Async**

```python
result = await async_client.health.with_raw_response.get_readiness()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Status
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetReadinessErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[Status](gavel_host_api/models/status.py), [GetReadinessErrorBody](gavel_host_api/errors/get_readiness_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[Status](gavel_host_api/models/status.py)</code> -- Ready.

**On `Failure`**: `error` is <code>[GetReadinessErrorBody](gavel_host_api/errors/get_readiness_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 503 | <code>[Readyz503Error1](gavel_host_api/models/readyz503_error1.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def get_version(*, request_options: RequestOptionsOrDict | None = None) -> ApiResult[VersionResponse, RawError]</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

The commit the running build was made from, or `unknown`. Never rate limited.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
result = client.health.with_raw_response.get_version()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type VersionResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RawError
```

**Async**

```python
result = await async_client.health.with_raw_response.get_version()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type VersionResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RawError
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[VersionResponse](gavel_host_api/models/version_response.py), [RawError](gavel_host_api/core/results.py)&#93;</code>

**On `Success`**: `payload` is <code>[VersionResponse](gavel_host_api/models/version_response.py)</code> -- Build sha.

**On `Failure`**: `error` is <code>[RawError](gavel_host_api/core/results.py)</code>

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def warmup(*, request_options: RequestOptionsOrDict | None = None) -> ApiResult[WarmupReport, WarmupErrorBody]</code></summary>

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

**Sync**

```python
result = client.health.with_raw_response.warmup()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type WarmupReport
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type WarmupErrorBody
```

**Async**

```python
result = await async_client.health.with_raw_response.warmup()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type WarmupReport
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type WarmupErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[WarmupReport](gavel_host_api/models/warmup_report.py), [WarmupErrorBody](gavel_host_api/errors/warmup_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[WarmupReport](gavel_host_api/models/warmup_report.py)</code> -- All steps warm.

**On `Failure`**: `error` is <code>[WarmupErrorBody](gavel_host_api/errors/warmup_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 429 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| 503 | <code>[WarmupReport](gavel_host_api/models/warmup_report.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

## Holds

> Source: [Holds](gavel_host_api/apis/holds.py)

<details>
<summary><code>def abandon_hold(hold_id: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiHoldsResponse1, AbandonHoldErrorBody]</code></summary>

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

**Sync**

```python
result = client.holds.with_raw_response.abandon_hold("hold_01")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiHoldsResponse1
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type AbandonHoldErrorBody
```

**Async**

```python
result = await async_client.holds.with_raw_response.abandon_hold("hold_01")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiHoldsResponse1
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type AbandonHoldErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>hold_id</code> | <code>str</code> | Id of the hold, as returned by the create-hold route. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiHoldsResponse1](gavel_host_api/models/api_holds_response1.py), [AbandonHoldErrorBody](gavel_host_api/errors/abandon_hold_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiHoldsResponse1](gavel_host_api/models/api_holds_response1.py)</code> -- Released (now or before).

**On `Failure`**: `error` is <code>[AbandonHoldErrorBody](gavel_host_api/errors/abandon_hold_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 404, 409, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def approve_hold(hold_id: str, body: ApiHoldsApproveRequest | ApiHoldsApproveRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiHoldsApproveResponse, ApproveHoldErrorBody]</code></summary>

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

**Sync**

```python
result = client.holds.with_raw_response.approve_hold(
    "hold_01", ApiHoldsApproveRequest(order_id="ORDER-EXAMPLE", name="Asha")
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiHoldsApproveResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ApproveHoldErrorBody
```

**Async**

```python
result = await async_client.holds.with_raw_response.approve_hold(
    "hold_01", ApiHoldsApproveRequest(order_id="ORDER-EXAMPLE", name="Asha")
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiHoldsApproveResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ApproveHoldErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>hold_id</code> | <code>str</code> | Id of the hold, as returned by the create-hold route. |
| <code>body</code> | <code>[ApiHoldsApproveRequest](gavel_host_api/models/api_holds_approve_request.py) \| [ApiHoldsApproveRequestDict](gavel_host_api/models/api_holds_approve_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiHoldsApproveResponse](gavel_host_api/models/api_holds_approve_response.py), [ApproveHoldErrorBody](gavel_host_api/errors/approve_hold_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiHoldsApproveResponse](gavel_host_api/models/api_holds_approve_response.py)</code> -- Hold authorized.

**On `Failure`**: `error` is <code>[ApproveHoldErrorBody](gavel_host_api/errors/approve_hold_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 404, 409, 413, 415, 429, 500, 503 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def create_hold(body: ApiHoldsRequest | ApiHoldsRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[CreateHoldResponse, CreateHoldErrorBody]</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Session token only. The bidder is the one in the token; a body that names a bidder is
rejected. The ceiling must be one of the auction's offered presets. Errors on the hold
routes are `{error, message}` with the codes in `HoldErrorCode`.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
result = client.holds.with_raw_response.create_hold(
    ApiHoldsRequest(auction_id="01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ceiling_cents=25000)
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type CreateHoldResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CreateHoldErrorBody
```

**Async**

```python
result = await async_client.holds.with_raw_response.create_hold(
    ApiHoldsRequest(auction_id="01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ceiling_cents=25000)
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type CreateHoldResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CreateHoldErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiHoldsRequest](gavel_host_api/models/api_holds_request.py) \| [ApiHoldsRequestDict](gavel_host_api/models/api_holds_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[CreateHoldResponse](gavel_host_api/models/create_hold_response.py), [CreateHoldErrorBody](gavel_host_api/errors/create_hold_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[CreateHoldResponse](gavel_host_api/models/create_hold_response.py)</code> -- Hold order created; approve it with PayPal, then call the approve route.

**On `Failure`**: `error` is <code>[CreateHoldErrorBody](gavel_host_api/errors/create_hold_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 404, 409, 413, 415, 429, 500, 503 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def get_hold(hold_id: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiHoldsResponse, GetHoldErrorBody]</code></summary>

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

**Sync**

```python
result = client.holds.with_raw_response.get_hold("hold_01")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiHoldsResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetHoldErrorBody
```

**Async**

```python
result = await async_client.holds.with_raw_response.get_hold("hold_01")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiHoldsResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetHoldErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>hold_id</code> | <code>str</code> | Id of the hold, as returned by the create-hold route. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiHoldsResponse](gavel_host_api/models/api_holds_response.py), [GetHoldErrorBody](gavel_host_api/errors/get_hold_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiHoldsResponse](gavel_host_api/models/api_holds_response.py)</code> -- The hold.

**On `Failure`**: `error` is <code>[GetHoldErrorBody](gavel_host_api/errors/get_hold_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 404, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

## JudgeRooms

> Source: [JudgeRooms](gavel_host_api/apis/judge_rooms.py)

<details>
<summary><code>def check_judge_key(*, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiJudgeKeyResponse, CheckJudgeKeyErrorBody]</code></summary>

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

**Sync**

```python
result = client.judge_rooms.with_raw_response.check_judge_key()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeKeyResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CheckJudgeKeyErrorBody
```

**Async**

```python
result = await async_client.judge_rooms.with_raw_response.check_judge_key()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeKeyResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CheckJudgeKeyErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiJudgeKeyResponse](gavel_host_api/models/api_judge_key_response.py), [CheckJudgeKeyErrorBody](gavel_host_api/errors/check_judge_key_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiJudgeKeyResponse](gavel_host_api/models/api_judge_key_response.py)</code> -- The key is accepted.

**On `Failure`**: `error` is <code>[CheckJudgeKeyErrorBody](gavel_host_api/errors/check_judge_key_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 404, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def create_judge_room(*, body: ApiJudgeRoomsRequest | ApiJudgeRoomsRequestDict | None = None, request_options: RequestOptionsOrDict | None = None) -> ApiResult[JudgeRoom, CreateJudgeRoomErrorBody]</code></summary>

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

**Sync**

```python
result = client.judge_rooms.with_raw_response.create_judge_room(body=ApiJudgeRoomsRequest(title="Sandbox demo lot"))
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type JudgeRoom
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CreateJudgeRoomErrorBody
```

**Async**

```python
result = await async_client.judge_rooms.with_raw_response.create_judge_room(
    body=ApiJudgeRoomsRequest(title="Sandbox demo lot")
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type JudgeRoom
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CreateJudgeRoomErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiJudgeRoomsRequest](gavel_host_api/models/api_judge_rooms_request.py) \| [ApiJudgeRoomsRequestDict](gavel_host_api/models/api_judge_rooms_request.py) \| None</code> | The request body.<br>**Default**: <code>None</code> |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[JudgeRoom](gavel_host_api/models/judge_room.py), [CreateJudgeRoomErrorBody](gavel_host_api/errors/create_judge_room_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[JudgeRoom](gavel_host_api/models/judge_room.py)</code> -- Room created.

**On `Failure`**: `error` is <code>[CreateJudgeRoomErrorBody](gavel_host_api/errors/create_judge_room_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 404, 413, 415, 429, 500, 503 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def create_simulated_hold(id_: str, body: ApiJudgeRoomsSimHoldRequest | ApiJudgeRoomsSimHoldRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiJudgeRoomsSimHoldResponse, CreateSimulatedHoldErrorBody]</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Session token of a bidder in that judge room. Writes an already-authorized hold with
no PayPal call and puts the bidder in the room, so the whole path can be tried without
a PayPal login. The ceiling is any whole number of cents from 100 up to the room's
ceiling cap (the top preset); the presets are only quick picks, and a value outside the
range is 400 `bad_message`. Any other auction answers 404. Answers 404 when simulated
holds are off.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
result = client.judge_rooms.with_raw_response.create_simulated_hold(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ApiJudgeRoomsSimHoldRequest(ceiling_cents=5000, name="Asha")
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeRoomsSimHoldResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CreateSimulatedHoldErrorBody
```

**Async**

```python
result = await async_client.judge_rooms.with_raw_response.create_simulated_hold(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ApiJudgeRoomsSimHoldRequest(ceiling_cents=5000, name="Asha")
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeRoomsSimHoldResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CreateSimulatedHoldErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>body</code> | <code>[ApiJudgeRoomsSimHoldRequest](gavel_host_api/models/api_judge_rooms_sim_hold_request.py) \| [ApiJudgeRoomsSimHoldRequestDict](gavel_host_api/models/api_judge_rooms_sim_hold_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiJudgeRoomsSimHoldResponse](gavel_host_api/models/api_judge_rooms_sim_hold_response.py), [CreateSimulatedHoldErrorBody](gavel_host_api/errors/create_simulated_hold_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiJudgeRoomsSimHoldResponse](gavel_host_api/models/api_judge_rooms_sim_hold_response.py)</code> -- Simulated hold placed.

**On `Failure`**: `error` is <code>[CreateSimulatedHoldErrorBody](gavel_host_api/errors/create_simulated_hold_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 403, 404, 409, 410, 413, 415, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def get_judge_capabilities(*, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiJudgeCapabilitiesResponse, GetJudgeCapabilitiesErrorBody]</code></summary>

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

**Sync**

```python
result = client.judge_rooms.with_raw_response.get_judge_capabilities()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeCapabilitiesResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetJudgeCapabilitiesErrorBody
```

**Async**

```python
result = await async_client.judge_rooms.with_raw_response.get_judge_capabilities()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeCapabilitiesResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetJudgeCapabilitiesErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiJudgeCapabilitiesResponse](gavel_host_api/models/api_judge_capabilities_response.py), [GetJudgeCapabilitiesErrorBody](gavel_host_api/errors/get_judge_capabilities_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiJudgeCapabilitiesResponse](gavel_host_api/models/api_judge_capabilities_response.py)</code> -- Capabilities.

**On `Failure`**: `error` is <code>[GetJudgeCapabilitiesErrorBody](gavel_host_api/errors/get_judge_capabilities_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def get_judge_room_ledger(id_: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ReplayBundle, GetJudgeRoomLedgerErrorBody]</code></summary>

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

**Sync**

```python
result = client.judge_rooms.with_raw_response.get_judge_room_ledger("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ReplayBundle
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetJudgeRoomLedgerErrorBody
```

**Async**

```python
result = await async_client.judge_rooms.with_raw_response.get_judge_room_ledger("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ReplayBundle
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetJudgeRoomLedgerErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ReplayBundle](gavel_host_api/models/replay_bundle.py), [GetJudgeRoomLedgerErrorBody](gavel_host_api/errors/get_judge_room_ledger_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ReplayBundle](gavel_host_api/models/replay_bundle.py)</code> -- The bundle.

**On `Failure`**: `error` is <code>[GetJudgeRoomLedgerErrorBody](gavel_host_api/errors/get_judge_room_ledger_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 404, 409, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def join_judge_room(body: ApiJudgeJoinRequest | ApiJudgeJoinRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiJudgeJoinResponse, JoinJudgeRoomErrorBody]</code></summary>

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

**Sync**

```python
result = client.judge_rooms.with_raw_response.join_judge_room(
    ApiJudgeJoinRequest(code="gvl-k7m 2qx", display_name="Asha")
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeJoinResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type JoinJudgeRoomErrorBody
```

**Async**

```python
result = await async_client.judge_rooms.with_raw_response.join_judge_room(
    ApiJudgeJoinRequest(code="gvl-k7m 2qx", display_name="Asha")
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeJoinResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type JoinJudgeRoomErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiJudgeJoinRequest](gavel_host_api/models/api_judge_join_request.py) \| [ApiJudgeJoinRequestDict](gavel_host_api/models/api_judge_join_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiJudgeJoinResponse](gavel_host_api/models/api_judge_join_response.py), [JoinJudgeRoomErrorBody](gavel_host_api/errors/join_judge_room_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiJudgeJoinResponse](gavel_host_api/models/api_judge_join_response.py)</code> -- Joined.

**On `Failure`**: `error` is <code>[JoinJudgeRoomErrorBody](gavel_host_api/errors/join_judge_room_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 404, 410, 413, 415, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def list_judge_keys(*, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiJudgeKeysResponse, ListJudgeKeysErrorBody]</code></summary>

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

**Sync**

```python
result = client.judge_rooms.with_raw_response.list_judge_keys()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeKeysResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ListJudgeKeysErrorBody
```

**Async**

```python
result = await async_client.judge_rooms.with_raw_response.list_judge_keys()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeKeysResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ListJudgeKeysErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiJudgeKeysResponse](gavel_host_api/models/api_judge_keys_response.py), [ListJudgeKeysErrorBody](gavel_host_api/errors/list_judge_keys_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiJudgeKeysResponse](gavel_host_api/models/api_judge_keys_response.py)</code> -- The keys.

**On `Failure`**: `error` is <code>[ListJudgeKeysErrorBody](gavel_host_api/errors/list_judge_keys_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def pause_judge_rooms(body: ApiJudgePauseRequest | ApiJudgePauseRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiJudgePauseResponse, PauseJudgeRoomsErrorBody]</code></summary>

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

**Sync**

```python
result = client.judge_rooms.with_raw_response.pause_judge_rooms(ApiJudgePauseRequest(paused=True))
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgePauseResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type PauseJudgeRoomsErrorBody
```

**Async**

```python
result = await async_client.judge_rooms.with_raw_response.pause_judge_rooms(ApiJudgePauseRequest(paused=True))
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgePauseResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type PauseJudgeRoomsErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiJudgePauseRequest](gavel_host_api/models/api_judge_pause_request.py) \| [ApiJudgePauseRequestDict](gavel_host_api/models/api_judge_pause_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiJudgePauseResponse](gavel_host_api/models/api_judge_pause_response.py), [PauseJudgeRoomsErrorBody](gavel_host_api/errors/pause_judge_rooms_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiJudgePauseResponse](gavel_host_api/models/api_judge_pause_response.py)</code> -- New state.

**On `Failure`**: `error` is <code>[PauseJudgeRoomsErrorBody](gavel_host_api/errors/pause_judge_rooms_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 413, 415, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def place_judge_bid(id_: str, body: ApiJudgeRoomsBidsRequest | ApiJudgeRoomsBidsRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiJudgeRoomsBidsResponse, PlaceJudgeBidErrorBody]</code></summary>

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

**Sync**

```python
result = client.judge_rooms.with_raw_response.place_judge_bid(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ApiJudgeRoomsBidsRequest(amount=1500)
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeRoomsBidsResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type PlaceJudgeBidErrorBody
```

**Async**

```python
result = await async_client.judge_rooms.with_raw_response.place_judge_bid(
    "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ApiJudgeRoomsBidsRequest(amount=1500)
)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeRoomsBidsResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type PlaceJudgeBidErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>body</code> | <code>[ApiJudgeRoomsBidsRequest](gavel_host_api/models/api_judge_rooms_bids_request.py) \| [ApiJudgeRoomsBidsRequestDict](gavel_host_api/models/api_judge_rooms_bids_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiJudgeRoomsBidsResponse](gavel_host_api/models/api_judge_rooms_bids_response.py), [PlaceJudgeBidErrorBody](gavel_host_api/errors/place_judge_bid_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiJudgeRoomsBidsResponse](gavel_host_api/models/api_judge_rooms_bids_response.py)</code> -- The bid was accepted.

**On `Failure`**: `error` is <code>[PlaceJudgeBidErrorBody](gavel_host_api/errors/place_judge_bid_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 403, 404, 410, 413, 415, 429, 500, 503 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| 409 | <code>[ApiJudgeRoomsBidsResponse21](gavel_host_api/models/unions/api_judge_rooms_bids_response21.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def revoke_judge_key(key_id: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiJudgeKeysRevokeResponse, RevokeJudgeKeyErrorBody]</code></summary>

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

**Sync**

```python
result = client.judge_rooms.with_raw_response.revoke_judge_key("some example string")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeKeysRevokeResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RevokeJudgeKeyErrorBody
```

**Async**

```python
result = await async_client.judge_rooms.with_raw_response.revoke_judge_key("some example string")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeKeysRevokeResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RevokeJudgeKeyErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>key_id</code> | <code>str</code> | The 8 character id inside the key (`gvl_judge_<id>_<secret>`), or `legacy`. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiJudgeKeysRevokeResponse](gavel_host_api/models/api_judge_keys_revoke_response.py), [RevokeJudgeKeyErrorBody](gavel_host_api/errors/revoke_judge_key_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiJudgeKeysRevokeResponse](gavel_host_api/models/api_judge_keys_revoke_response.py)</code> -- The key is revoked.

**On `Failure`**: `error` is <code>[RevokeJudgeKeyErrorBody](gavel_host_api/errors/revoke_judge_key_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 404, 429, 500, 503 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

## Operator

> Source: [Operator](gavel_host_api/apis/operator.py)

<details>
<summary><code>def admin_export(*, auction: str | None = None, list_: ListOrStr | None = None, kind: KindOrStr | None = None, request_options: RequestOptionsOrDict | None = None) -> ApiResult[None, AdminExportErrorBody]</code></summary>

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

**Sync**

```python
result = client.operator.with_raw_response.admin_export(list_=List._1, kind=Kind.PAYMENTS)
match result:
    case Success():
        ...  # 2xx, no content
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type AdminExportErrorBody
```

**Async**

```python
result = await async_client.operator.with_raw_response.admin_export(list_=List._1, kind=Kind.PAYMENTS)
match result:
    case Success():
        ...  # 2xx, no content
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type AdminExportErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>auction</code> | <code>str \| None</code> | Auction id (`auctionId` is accepted as an alias).<br>**Default**: <code>None</code> |
| <code>list_</code> | <code>[ListOrStr](gavel_host_api/models/enums/list.py) \| None</code> | Send `1` to list every auction id instead of exporting one auction.<br>**Default**: <code>None</code> |
| <code>kind</code> | <code>[KindOrStr](gavel_host_api/models/enums/kind.py) \| None</code> | Which export to return. Without it, `auction` returns the ledger.<br>**Default**: <code>None</code> |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;None, [AdminExportErrorBody](gavel_host_api/errors/admin_export_error.py)&#93;</code>

**On `Success`**: the 2xx carries no content; `payload` is <code>None</code>

**On `Failure`**: `error` is <code>[AdminExportErrorBody](gavel_host_api/errors/admin_export_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 404, 405, 429, 500, 501 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def admin_replay_bundle(auction_id: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[Any, AdminReplayBundleErrorBody]</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. A self-contained bundle of the auction's ledger for replay and
verification. Query `auctionId` is required. 409 when the hash chain is broken.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
result = client.operator.with_raw_response.admin_replay_bundle("01J9ZZ0000000000000000000A")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Any
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type AdminReplayBundleErrorBody
```

**Async**

```python
result = await async_client.operator.with_raw_response.admin_replay_bundle("01J9ZZ0000000000000000000A")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Any
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type AdminReplayBundleErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>auction_id</code> | <code>str</code> | Id of the auction to bundle. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;Any, [AdminReplayBundleErrorBody](gavel_host_api/errors/admin_replay_bundle_error.py)&#93;</code>

**On `Success`**: `payload` is <code>Any</code> -- The bundle (format defined in `packages/shared/src/replay-bundle.ts`).

**On `Failure`**: `error` is <code>[AdminReplayBundleErrorBody](gavel_host_api/errors/admin_replay_bundle_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 404, 405, 409, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def get_metrics(*, request_options: RequestOptionsOrDict | None = None) -> ApiResult[Any, GetMetricsErrorBody]</code></summary>

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

**Sync**

```python
result = client.operator.with_raw_response.get_metrics()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Any
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetMetricsErrorBody
```

**Async**

```python
result = await async_client.operator.with_raw_response.get_metrics()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type Any
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetMetricsErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;Any, [GetMetricsErrorBody](gavel_host_api/errors/get_metrics_error.py)&#93;</code>

**On `Success`**: `payload` is <code>Any</code> -- The collector snapshot.

**On `Failure`**: `error` is <code>[GetMetricsErrorBody](gavel_host_api/errors/get_metrics_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 405, 429 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def get_metrics_prometheus(*, request_options: RequestOptionsOrDict | None = None) -> ApiResult[str, GetMetricsPrometheusErrorBody]</code></summary>

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

**Sync**

```python
result = client.operator.with_raw_response.get_metrics_prometheus()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type str
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetMetricsPrometheusErrorBody
```

**Async**

```python
result = await async_client.operator.with_raw_response.get_metrics_prometheus()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type str
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetMetricsPrometheusErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;str, [GetMetricsPrometheusErrorBody](gavel_host_api/errors/get_metrics_prometheus_error.py)&#93;</code>

**On `Success`**: `payload` is <code>str</code> -- Prometheus exposition text.

**On `Failure`**: `error` is <code>[GetMetricsPrometheusErrorBody](gavel_host_api/errors/get_metrics_prometheus_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 405, 429 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def get_ops_summary(*, request_options: RequestOptionsOrDict | None = None) -> ApiResult[OpsSummaryResponse, GetOpsSummaryErrorBody]</code></summary>

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

**Sync**

```python
result = client.operator.with_raw_response.get_ops_summary()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type OpsSummaryResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetOpsSummaryErrorBody
```

**Async**

```python
result = await async_client.operator.with_raw_response.get_ops_summary()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type OpsSummaryResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetOpsSummaryErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[OpsSummaryResponse](gavel_host_api/models/ops_summary_response.py), [GetOpsSummaryErrorBody](gavel_host_api/errors/get_ops_summary_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[OpsSummaryResponse](gavel_host_api/models/ops_summary_response.py)</code> -- Summary.

**On `Failure`**: `error` is <code>[GetOpsSummaryErrorBody](gavel_host_api/errors/get_ops_summary_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 405, 429 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def list_judge_keys(*, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiJudgeKeysResponse, ListJudgeKeysErrorBody]</code></summary>

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

**Sync**

```python
result = client.operator.with_raw_response.list_judge_keys()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeKeysResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ListJudgeKeysErrorBody
```

**Async**

```python
result = await async_client.operator.with_raw_response.list_judge_keys()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeKeysResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ListJudgeKeysErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiJudgeKeysResponse](gavel_host_api/models/api_judge_keys_response.py), [ListJudgeKeysErrorBody](gavel_host_api/errors/list_judge_keys_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiJudgeKeysResponse](gavel_host_api/models/api_judge_keys_response.py)</code> -- The keys.

**On `Failure`**: `error` is <code>[ListJudgeKeysErrorBody](gavel_host_api/errors/list_judge_keys_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def list_ops_rooms(*, request_options: RequestOptionsOrDict | None = None) -> ApiResult[OpsRoomsResponse, ListOpsRoomsErrorBody]</code></summary>

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

**Sync**

```python
result = client.operator.with_raw_response.list_ops_rooms()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type OpsRoomsResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ListOpsRoomsErrorBody
```

**Async**

```python
result = await async_client.operator.with_raw_response.list_ops_rooms()
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type OpsRoomsResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ListOpsRoomsErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[OpsRoomsResponse](gavel_host_api/models/ops_rooms_response.py), [ListOpsRoomsErrorBody](gavel_host_api/errors/list_ops_rooms_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[OpsRoomsResponse](gavel_host_api/models/ops_rooms_response.py)</code> -- Loaded rooms.

**On `Failure`**: `error` is <code>[ListOpsRoomsErrorBody](gavel_host_api/errors/list_ops_rooms_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 405, 429 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def ops_release_review(id_: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[OpsAuctionsReleaseReviewResponse, OpsReleaseReviewErrorBody]</code></summary>

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

**Sync**

```python
result = client.operator.with_raw_response.ops_release_review("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type OpsAuctionsReleaseReviewResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type OpsReleaseReviewErrorBody
```

**Async**

```python
result = await async_client.operator.with_raw_response.ops_release_review("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type OpsAuctionsReleaseReviewResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type OpsReleaseReviewErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[OpsAuctionsReleaseReviewResponse](gavel_host_api/models/ops_auctions_release_review_response.py), [OpsReleaseReviewErrorBody](gavel_host_api/errors/ops_release_review_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[OpsAuctionsReleaseReviewResponse](gavel_host_api/models/ops_auctions_release_review_response.py)</code> -- Released.

**On `Failure`**: `error` is <code>[OpsReleaseReviewErrorBody](gavel_host_api/errors/ops_release_review_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 404, 405, 409, 429 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def ops_void_all(id_: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[OpsAuctionsVoidAllResponse, OpsVoidAllErrorBody]</code></summary>

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

**Sync**

```python
result = client.operator.with_raw_response.ops_void_all("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type OpsAuctionsVoidAllResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type OpsVoidAllErrorBody
```

**Async**

```python
result = await async_client.operator.with_raw_response.ops_void_all("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type OpsAuctionsVoidAllResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type OpsVoidAllErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[OpsAuctionsVoidAllResponse](gavel_host_api/models/ops_auctions_void_all_response.py), [OpsVoidAllErrorBody](gavel_host_api/errors/ops_void_all_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[OpsAuctionsVoidAllResponse](gavel_host_api/models/ops_auctions_void_all_response.py)</code> -- Done.

**On `Failure`**: `error` is <code>[OpsVoidAllErrorBody](gavel_host_api/errors/ops_void_all_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 404, 405, 409, 429 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def pause_judge_rooms(body: ApiJudgePauseRequest | ApiJudgePauseRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiJudgePauseResponse, PauseJudgeRoomsErrorBody]</code></summary>

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

**Sync**

```python
result = client.operator.with_raw_response.pause_judge_rooms(ApiJudgePauseRequest(paused=True))
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgePauseResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type PauseJudgeRoomsErrorBody
```

**Async**

```python
result = await async_client.operator.with_raw_response.pause_judge_rooms(ApiJudgePauseRequest(paused=True))
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgePauseResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type PauseJudgeRoomsErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiJudgePauseRequest](gavel_host_api/models/api_judge_pause_request.py) \| [ApiJudgePauseRequestDict](gavel_host_api/models/api_judge_pause_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiJudgePauseResponse](gavel_host_api/models/api_judge_pause_response.py), [PauseJudgeRoomsErrorBody](gavel_host_api/errors/pause_judge_rooms_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiJudgePauseResponse](gavel_host_api/models/api_judge_pause_response.py)</code> -- New state.

**On `Failure`**: `error` is <code>[PauseJudgeRoomsErrorBody](gavel_host_api/errors/pause_judge_rooms_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 413, 415, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def revoke_judge_key(key_id: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiJudgeKeysRevokeResponse, RevokeJudgeKeyErrorBody]</code></summary>

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

**Sync**

```python
result = client.operator.with_raw_response.revoke_judge_key("some example string")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeKeysRevokeResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RevokeJudgeKeyErrorBody
```

**Async**

```python
result = await async_client.operator.with_raw_response.revoke_judge_key("some example string")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiJudgeKeysRevokeResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type RevokeJudgeKeyErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>key_id</code> | <code>str</code> | The 8 character id inside the key (`gvl_judge_<id>_<secret>`), or `legacy`. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiJudgeKeysRevokeResponse](gavel_host_api/models/api_judge_keys_revoke_response.py), [RevokeJudgeKeyErrorBody](gavel_host_api/errors/revoke_judge_key_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiJudgeKeysRevokeResponse](gavel_host_api/models/api_judge_keys_revoke_response.py)</code> -- The key is revoked.

**On `Failure`**: `error` is <code>[RevokeJudgeKeyErrorBody](gavel_host_api/errors/revoke_judge_key_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 404, 429, 500, 503 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

## Read

> Source: [Read](gavel_host_api/apis/read.py)

<details>
<summary><code>def get_snapshot(id_: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[StateFrame, GetSnapshotErrorBody]</code></summary>

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

**Sync**

```python
result = client.read.with_raw_response.get_snapshot("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type StateFrame
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetSnapshotErrorBody
```

**Async**

```python
result = await async_client.read.with_raw_response.get_snapshot("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type StateFrame
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetSnapshotErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[StateFrame](gavel_host_api/models/state_frame.py), [GetSnapshotErrorBody](gavel_host_api/errors/get_snapshot_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[StateFrame](gavel_host_api/models/state_frame.py)</code> -- The state frame.

**On `Failure`**: `error` is <code>[GetSnapshotErrorBody](gavel_host_api/errors/get_snapshot_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 403, 404, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def list_events(id_: str, *, after: int | None = 0, limit: int | None = 100, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiAuctionsEventsResponse, ListEventsErrorBody]</code></summary>

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

**Sync**

```python
result = client.read.with_raw_response.list_events("01JC5ZP4M7Q8R9S0T1V2W3X4Y5", after=0, limit=100)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiAuctionsEventsResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ListEventsErrorBody
```

**Async**

```python
result = await async_client.read.with_raw_response.list_events("01JC5ZP4M7Q8R9S0T1V2W3X4Y5", after=0, limit=100)
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiAuctionsEventsResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type ListEventsErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>after</code> | <code>int \| None</code> | Return events after this sequence number. Pass the `next` of the previous page to continue.<br>**Default**: <code>0</code> |
| <code>limit</code> | <code>int \| None</code> | Most events to return in one page.<br>**Default**: <code>100</code> |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiAuctionsEventsResponse](gavel_host_api/models/api_auctions_events_response.py), [ListEventsErrorBody](gavel_host_api/errors/list_events_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiAuctionsEventsResponse](gavel_host_api/models/api_auctions_events_response.py)</code> -- A page of events.

**On `Failure`**: `error` is <code>[ListEventsErrorBody](gavel_host_api/errors/list_events_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 401, 404, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

## Receipts

> Source: [Receipts](gavel_host_api/apis/receipts.py)

<details>
<summary><code>def create_receipt_link(id_: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiAuctionsReceiptLinkResponse, CreateReceiptLinkErrorBody]</code></summary>

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

**Sync**

```python
result = client.receipts.with_raw_response.create_receipt_link("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiAuctionsReceiptLinkResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CreateReceiptLinkErrorBody
```

**Async**

```python
result = await async_client.receipts.with_raw_response.create_receipt_link("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiAuctionsReceiptLinkResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type CreateReceiptLinkErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiAuctionsReceiptLinkResponse](gavel_host_api/models/api_auctions_receipt_link_response.py), [CreateReceiptLinkErrorBody](gavel_host_api/errors/create_receipt_link_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiAuctionsReceiptLinkResponse](gavel_host_api/models/api_auctions_receipt_link_response.py)</code> -- Receipt link.

**On `Failure`**: `error` is <code>[CreateReceiptLinkErrorBody](gavel_host_api/errors/create_receipt_link_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 403, 404, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def get_receipt(id_: str, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[ApiAuctionsReceiptResponse, GetReceiptErrorBody]</code></summary>

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

**Sync**

```python
result = client.receipts.with_raw_response.get_receipt("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiAuctionsReceiptResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetReceiptErrorBody
```

**Async**

```python
result = await async_client.receipts.with_raw_response.get_receipt("01JC5ZP4M7Q8R9S0T1V2W3X4Y5")
match result:
    case Success(payload=payload):
        ...  # TODO: Handle 'payload' of type ApiAuctionsReceiptResponse
    case Failure(error=error):
        ...  # TODO: Handle 'error' of type GetReceiptErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id_</code> | <code>str</code> | Auction id. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](gavel_host_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**Returns**: <code>[ApiResult](gavel_host_api/core/results.py)&#91;[ApiAuctionsReceiptResponse](gavel_host_api/models/api_auctions_receipt_response.py), [GetReceiptErrorBody](gavel_host_api/errors/get_receipt_error.py)&#93;</code>

**On `Success`**: `payload` is <code>[ApiAuctionsReceiptResponse](gavel_host_api/models/api_auctions_receipt_response.py)</code> -- The receipt.

**On `Failure`**: `error` is <code>[GetReceiptErrorBody](gavel_host_api/errors/get_receipt_error.py)</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 401, 404, 429, 500 | <code>[Error5](gavel_host_api/models/unions/error5.py)</code> |
| anything unmapped | <code>[RawError](gavel_host_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

