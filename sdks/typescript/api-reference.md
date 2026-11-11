# Reference

> Source: [GavelHostApiClient](src/client.ts)

## Auctions

> Source: [Auctions](src/resources/auctions.ts)

<details>
<summary><code>createAuction(request: Auctions.CreateAuctionRequestParams, options?: RequestOptions): ApiPromise&lt;CreateAuctionResponse, Auctions.CreateAuctionError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.auctions.createAuction({
    body: {
      title: "Charity quilt",
      config: {
        mode: Mode.English,
        reserve: 10000,
        minIncrement: 500,
        endTs: 1767225600000,
        softCloseWindowMs: 30000,
        softCloseExtensionMs: 30000,
        maxExtensions: 5,
        ceilingPresets: [10000, 25000, 50000],
        confirmConfidenceThreshold: 0.85,
      },
      fundraiserGoalCents: 500000,
    },
  });
  // TODO: Handle 'response' of type CreateAuctionResponse
} catch (err) {
  // TODO: Handle 'err' of type Auctions.CreateAuctionError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.auctions.createAuction({
  body: {
    title: "Charity quilt",
    config: {
      mode: Mode.English,
      reserve: 10000,
      minIncrement: 500,
      endTs: 1767225600000,
      softCloseWindowMs: 30000,
      softCloseExtensionMs: 30000,
      maxExtensions: 5,
      ceilingPresets: [10000, 25000, 50000],
      confirmConfidenceThreshold: 0.85,
    },
    fundraiserGoalCents: 500000,
  },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type CreateAuctionResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[CreateAuctionRequest](src/models/create-auction-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.auctions.createAuction(request)`

- **OnSuccess**: <code>[CreateAuctionResponse](src/models/create-auction-response.ts)</code>
- **OnError**: throws <code>[Auctions.CreateAuctionError](src/resources/auctions.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.auctions.createAuction(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;CreateAuctionResponse, Auctions.CreateAuctionError&gt;</code>, with `result.value` of type <code>[CreateAuctionResponse](src/models/create-auction-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getAuction(request: Auctions.GetAuctionRequest, options?: RequestOptions): ApiPromise&lt;AuctionPublic, Auctions.GetAuctionError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.auctions.getAuction({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
  // TODO: Handle 'response' of type AuctionPublic
} catch (err) {
  // TODO: Handle 'err' of type Auctions.GetAuctionError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.auctions.getAuction({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type AuctionPublic
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id, or its 6 character join code. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.auctions.getAuction(request)`

- **OnSuccess**: <code>[AuctionPublic](src/models/auction-public.ts)</code>
- **OnError**: throws <code>[Auctions.GetAuctionError](src/resources/auctions.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.auctions.getAuction(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;AuctionPublic, Auctions.GetAuctionError&gt;</code>, with `result.value` of type <code>[AuctionPublic](src/models/auction-public.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>revokeAllAuctioneerTokens(request: Auctions.RevokeAllAuctioneerTokensRequest, options?: RequestOptions): ApiPromise&lt;Revoked, Auctions.RevokeAllAuctioneerTokensError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. Kills every auctioneer token of the auction and issues no new one.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.auctions.revokeAllAuctioneerTokens({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
  // TODO: Handle 'response' of type Revoked
} catch (err) {
  // TODO: Handle 'err' of type Auctions.RevokeAllAuctioneerTokensError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.auctions.revokeAllAuctioneerTokens({
  id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Revoked
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.auctions.revokeAllAuctioneerTokens(request)`

- **OnSuccess**: <code>[Revoked](src/models/revoked.ts)</code>
- **OnError**: throws <code>[Auctions.RevokeAllAuctioneerTokensError](src/resources/auctions.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.auctions.revokeAllAuctioneerTokens(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Revoked, Auctions.RevokeAllAuctioneerTokensError&gt;</code>, with `result.value` of type <code>[Revoked](src/models/revoked.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>revokeAuctioneerToken(request: Auctions.RevokeAuctioneerTokenRequest, options?: RequestOptions): ApiPromise&lt;Revoked, Auctions.RevokeAuctioneerTokenError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. For a lost or leaked link when you know its token id.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.auctions.revokeAuctioneerToken({
    id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    body: { jti: "01JC5ZQ0A1B2C3D4E5F6G7H8J9" },
  });
  // TODO: Handle 'response' of type Revoked
} catch (err) {
  // TODO: Handle 'err' of type Auctions.RevokeAuctioneerTokenError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.auctions.revokeAuctioneerToken({
  id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
  body: { jti: "01JC5ZQ0A1B2C3D4E5F6G7H8J9" },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Revoked
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |
| <code>body</code> | <code>[ApiAuctionsAuctioneerRevokeRequest](src/models/api-auctions-auctioneer-revoke-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.auctions.revokeAuctioneerToken(request)`

- **OnSuccess**: <code>[Revoked](src/models/revoked.ts)</code>
- **OnError**: throws <code>[Auctions.RevokeAuctioneerTokenError](src/resources/auctions.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.auctions.revokeAuctioneerToken(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Revoked, Auctions.RevokeAuctioneerTokenError&gt;</code>, with `result.value` of type <code>[Revoked](src/models/revoked.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>rotateAuctioneerToken(request: Auctions.RotateAuctioneerTokenRequest, options?: RequestOptions): ApiPromise&lt;ApiAuctionsAuctioneerRotateResponse, Auctions.RotateAuctioneerTokenError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. Kills every auctioneer token issued before now and returns a fresh link.
A leaked auctioneer link cannot do this, by design.


</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.auctions.rotateAuctioneerToken({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
  // TODO: Handle 'response' of type ApiAuctionsAuctioneerRotateResponse
} catch (err) {
  // TODO: Handle 'err' of type Auctions.RotateAuctioneerTokenError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.auctions.rotateAuctioneerToken({
  id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiAuctionsAuctioneerRotateResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.auctions.rotateAuctioneerToken(request)`

- **OnSuccess**: <code>[ApiAuctionsAuctioneerRotateResponse](src/models/api-auctions-auctioneer-rotate-response.ts)</code>
- **OnError**: throws <code>[Auctions.RotateAuctioneerTokenError](src/resources/auctions.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.auctions.rotateAuctioneerToken(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiAuctionsAuctioneerRotateResponse, Auctions.RotateAuctioneerTokenError&gt;</code>, with `result.value` of type <code>[ApiAuctionsAuctioneerRotateResponse](src/models/api-auctions-auctioneer-rotate-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## BiddingAccess

> Source: [BiddingAccess](src/resources/bidding-access.ts)

<details>
<summary><code>createInvites(request: BiddingAccess.CreateInvitesRequest, options?: RequestOptions): ApiPromise&lt;ApiAuctionsInvitesResponse, BiddingAccess.CreateInvitesError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Auctioneer token only. Each invite is a single-use link, valid 24 hours, for one new
bidder id. Between 1 and 50 per call.


</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.biddingAccess.createInvites({
    id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    body: { count: 2 },
  });
  // TODO: Handle 'response' of type ApiAuctionsInvitesResponse
} catch (err) {
  // TODO: Handle 'err' of type BiddingAccess.CreateInvitesError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.biddingAccess.createInvites({
  id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
  body: { count: 2 },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiAuctionsInvitesResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |
| <code>body?</code> | <code>[ApiAuctionsInvitesRequest](src/models/api-auctions-invites-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.biddingAccess.createInvites(request)`

- **OnSuccess**: <code>[ApiAuctionsInvitesResponse](src/models/api-auctions-invites-response.ts)</code>
- **OnError**: throws <code>[BiddingAccess.CreateInvitesError](src/resources/bidding-access.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.biddingAccess.createInvites(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiAuctionsInvitesResponse, BiddingAccess.CreateInvitesError&gt;</code>, with `result.value` of type <code>[ApiAuctionsInvitesResponse](src/models/api-auctions-invites-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>joinAuction(request: BiddingAccess.JoinAuctionRequest, options?: RequestOptions): ApiPromise&lt;JoinResponse, BiddingAccess.JoinAuctionError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.biddingAccess.joinAuction({
    id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    body: { invite: "INVITE_TOKEN" },
  });
  // TODO: Handle 'response' of type JoinResponse
} catch (err) {
  // TODO: Handle 'err' of type BiddingAccess.JoinAuctionError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.biddingAccess.joinAuction({
  id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
  body: { invite: "INVITE_TOKEN" },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type JoinResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id, or its 6 character join code. |
| <code>body</code> | <code>[ApiAuctionsJoinRequest](src/models/api-auctions-join-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.biddingAccess.joinAuction(request)`

- **OnSuccess**: <code>[JoinResponse](src/models/join-response.ts)</code>
- **OnError**: throws <code>[BiddingAccess.JoinAuctionError](src/resources/bidding-access.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.biddingAccess.joinAuction(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;JoinResponse, BiddingAccess.JoinAuctionError&gt;</code>, with `result.value` of type <code>[JoinResponse](src/models/join-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>reissueInvite(request: BiddingAccess.ReissueInviteRequest, options?: RequestOptions): ApiPromise&lt;Invite, BiddingAccess.ReissueInviteError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.biddingAccess.reissueInvite({
    id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    bidderId: "01J9ZZ0000000000000000000B",
  });
  // TODO: Handle 'response' of type Invite
} catch (err) {
  // TODO: Handle 'err' of type BiddingAccess.ReissueInviteError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.biddingAccess.reissueInvite({
  id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
  bidderId: "01J9ZZ0000000000000000000B",
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Invite
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |
| <code>bidderId</code> | <code>string</code> | Id of the registered bidder to re-invite. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.biddingAccess.reissueInvite(request)`

- **OnSuccess**: <code>[Invite](src/models/invite.ts)</code>
- **OnError**: throws <code>[BiddingAccess.ReissueInviteError](src/resources/bidding-access.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.biddingAccess.reissueInvite(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Invite, BiddingAccess.ReissueInviteError&gt;</code>, with `result.value` of type <code>[Invite](src/models/invite.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Control

> Source: [Control](src/resources/control.ts)

<details>
<summary><code>controlAuction(request: Control.ControlAuctionRequest, options?: RequestOptions): ApiPromise&lt;ControlResponse, Control.ControlAuctionError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.control.controlAuction({
    id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    body: { controlId: "ctl-001", action: Action.Pause },
  });
  // TODO: Handle 'response' of type ControlResponse
} catch (err) {
  // TODO: Handle 'err' of type Control.ControlAuctionError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.control.controlAuction({
  id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
  body: { controlId: "ctl-001", action: Action.Pause },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ControlResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |
| <code>body</code> | <code>[ControlRequest](src/models/control-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.control.controlAuction(request)`

- **OnSuccess**: <code>[ControlResponse](src/models/control-response.ts)</code>
- **OnError**: throws <code>[Control.ControlAuctionError](src/resources/control.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.control.controlAuction(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ControlResponse, Control.ControlAuctionError&gt;</code>, with `result.value` of type <code>[ControlResponse](src/models/control-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>killAuction(request: Control.KillAuctionRequest, options?: RequestOptions): ApiPromise&lt;ApiAuctionsKillResponse, Control.KillAuctionError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.control.killAuction({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", body: {} });
  // TODO: Handle 'response' of type ApiAuctionsKillResponse
} catch (err) {
  // TODO: Handle 'err' of type Control.KillAuctionError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.control.killAuction({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", body: {} }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiAuctionsKillResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |
| <code>body</code> | <code>[ApiAuctionsKillRequest](src/models/api-auctions-kill-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.control.killAuction(request)`

- **OnSuccess**: <code>[ApiAuctionsKillResponse](src/models/api-auctions-kill-response.ts)</code>
- **OnError**: throws <code>[Control.KillAuctionError](src/resources/control.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.control.killAuction(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiAuctionsKillResponse, Control.KillAuctionError&gt;</code>, with `result.value` of type <code>[ApiAuctionsKillResponse](src/models/api-auctions-kill-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Read

> Source: [Read](src/resources/read.ts)

<details>
<summary><code>getSnapshot(request: Read.GetSnapshotRequest, options?: RequestOptions): ApiPromise&lt;StateFrame, Read.GetSnapshotError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.read.getSnapshot({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
  // TODO: Handle 'response' of type StateFrame
} catch (err) {
  // TODO: Handle 'err' of type Read.GetSnapshotError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.read.getSnapshot({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type StateFrame
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.read.getSnapshot(request)`

- **OnSuccess**: <code>[StateFrame](src/models/state-frame.ts)</code>
- **OnError**: throws <code>[Read.GetSnapshotError](src/resources/read.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.read.getSnapshot(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;StateFrame, Read.GetSnapshotError&gt;</code>, with `result.value` of type <code>[StateFrame](src/models/state-frame.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>listEvents(request: Read.ListEventsRequest, options?: RequestOptions): ApiPromise&lt;ApiAuctionsEventsResponse, Read.ListEventsError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.read.listEvents({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", after: 0, limit: 100 });
  // TODO: Handle 'response' of type ApiAuctionsEventsResponse
} catch (err) {
  // TODO: Handle 'err' of type Read.ListEventsError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.read.listEvents({
  id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
  after: 0,
  limit: 100,
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiAuctionsEventsResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |
| <code>after?</code> | <code>number</code> | Return events after this sequence number. Pass the `next` of the previous page to continue.<br>**Default**: 0 |
| <code>limit?</code> | <code>number</code> | Most events to return in one page.<br>**Default**: 100 |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.read.listEvents(request)`

- **OnSuccess**: <code>[ApiAuctionsEventsResponse](src/models/api-auctions-events-response.ts)</code>
- **OnError**: throws <code>[Read.ListEventsError](src/resources/read.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.read.listEvents(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiAuctionsEventsResponse, Read.ListEventsError&gt;</code>, with `result.value` of type <code>[ApiAuctionsEventsResponse](src/models/api-auctions-events-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Holds

> Source: [Holds](src/resources/holds.ts)

<details>
<summary><code>abandonHold(request: Holds.AbandonHoldRequest, options?: RequestOptions): ApiPromise&lt;ApiHoldsResponse1, Holds.AbandonHoldError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Session token of the hold's owner. Idempotent. A hold that is already authorized is
not released: it answers 409 `hold_exists`.


</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.holds.abandonHold({ holdId: "hold_01" });
  // TODO: Handle 'response' of type ApiHoldsResponse1
} catch (err) {
  // TODO: Handle 'err' of type Holds.AbandonHoldError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.holds.abandonHold({ holdId: "hold_01" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiHoldsResponse1
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>holdId</code> | <code>string</code> | Id of the hold, as returned by the create-hold route. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.holds.abandonHold(request)`

- **OnSuccess**: <code>[ApiHoldsResponse1](src/models/api-holds-response1.ts)</code>
- **OnError**: throws <code>[Holds.AbandonHoldError](src/resources/holds.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.holds.abandonHold(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiHoldsResponse1, Holds.AbandonHoldError&gt;</code>, with `result.value` of type <code>[ApiHoldsResponse1](src/models/api-holds-response1.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>approveHold(request: Holds.ApproveHoldRequest, options?: RequestOptions): ApiPromise&lt;ApiHoldsApproveResponse, Holds.ApproveHoldError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.holds.approveHold({
    holdId: "hold_01",
    body: { orderId: "ORDER-EXAMPLE", name: "Asha" },
  });
  // TODO: Handle 'response' of type ApiHoldsApproveResponse
} catch (err) {
  // TODO: Handle 'err' of type Holds.ApproveHoldError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.holds.approveHold({
  holdId: "hold_01",
  body: { orderId: "ORDER-EXAMPLE", name: "Asha" },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiHoldsApproveResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>holdId</code> | <code>string</code> | Id of the hold, as returned by the create-hold route. |
| <code>body</code> | <code>[ApiHoldsApproveRequest](src/models/api-holds-approve-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.holds.approveHold(request)`

- **OnSuccess**: <code>[ApiHoldsApproveResponse](src/models/api-holds-approve-response.ts)</code>
- **OnError**: throws <code>[Holds.ApproveHoldError](src/resources/holds.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.holds.approveHold(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiHoldsApproveResponse, Holds.ApproveHoldError&gt;</code>, with `result.value` of type <code>[ApiHoldsApproveResponse](src/models/api-holds-approve-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>createHold(request: Holds.CreateHoldRequest, options?: RequestOptions): ApiPromise&lt;CreateHoldResponse, Holds.CreateHoldError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.holds.createHold({
    body: { auctionId: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ceilingCents: 25000 },
  });
  // TODO: Handle 'response' of type CreateHoldResponse
} catch (err) {
  // TODO: Handle 'err' of type Holds.CreateHoldError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.holds.createHold({
  body: { auctionId: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5", ceilingCents: 25000 },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type CreateHoldResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiHoldsRequest](src/models/api-holds-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.holds.createHold(request)`

- **OnSuccess**: <code>[CreateHoldResponse](src/models/create-hold-response.ts)</code>
- **OnError**: throws <code>[Holds.CreateHoldError](src/resources/holds.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.holds.createHold(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;CreateHoldResponse, Holds.CreateHoldError&gt;</code>, with `result.value` of type <code>[CreateHoldResponse](src/models/create-hold-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getHold(request: Holds.GetHoldRequest, options?: RequestOptions): ApiPromise&lt;ApiHoldsResponse, Holds.GetHoldError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Session token of the hold's owner. Anyone else's hold answers 404.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.holds.getHold({ holdId: "hold_01" });
  // TODO: Handle 'response' of type ApiHoldsResponse
} catch (err) {
  // TODO: Handle 'err' of type Holds.GetHoldError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.holds.getHold({ holdId: "hold_01" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiHoldsResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>holdId</code> | <code>string</code> | Id of the hold, as returned by the create-hold route. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.holds.getHold(request)`

- **OnSuccess**: <code>[ApiHoldsResponse](src/models/api-holds-response.ts)</code>
- **OnError**: throws <code>[Holds.GetHoldError](src/resources/holds.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.holds.getHold(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiHoldsResponse, Holds.GetHoldError&gt;</code>, with `result.value` of type <code>[ApiHoldsResponse](src/models/api-holds-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## JudgeRooms

> Source: [JudgeRooms](src/resources/judge-rooms.ts)

<details>
<summary><code>checkJudgeKey(options?: RequestOptions): ApiPromise&lt;ApiJudgeKeyResponse, JudgeRooms.CheckJudgeKeyError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.judgeRooms.checkJudgeKey();
  // TODO: Handle 'response' of type ApiJudgeKeyResponse
} catch (err) {
  // TODO: Handle 'err' of type JudgeRooms.CheckJudgeKeyError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.judgeRooms.checkJudgeKey().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiJudgeKeyResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.judgeRooms.checkJudgeKey()`

- **OnSuccess**: <code>[ApiJudgeKeyResponse](src/models/api-judge-key-response.ts)</code>
- **OnError**: throws <code>[JudgeRooms.CheckJudgeKeyError](src/resources/judge-rooms.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.judgeRooms.checkJudgeKey().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiJudgeKeyResponse, JudgeRooms.CheckJudgeKeyError&gt;</code>, with `result.value` of type <code>[ApiJudgeKeyResponse](src/models/api-judge-key-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>createJudgeRoom(request?: JudgeRooms.CreateJudgeRoomRequest, options?: RequestOptions): ApiPromise&lt;JudgeRoom, JudgeRooms.CreateJudgeRoomError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.judgeRooms.createJudgeRoom({ body: { title: "Sandbox demo lot" } });
  // TODO: Handle 'response' of type JudgeRoom
} catch (err) {
  // TODO: Handle 'err' of type JudgeRooms.CreateJudgeRoomError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.judgeRooms.createJudgeRoom({ body: { title: "Sandbox demo lot" } }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type JudgeRoom
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body?</code> | <code>[ApiJudgeRoomsRequest](src/models/api-judge-rooms-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.judgeRooms.createJudgeRoom(request)`

- **OnSuccess**: <code>[JudgeRoom](src/models/judge-room.ts)</code>
- **OnError**: throws <code>[JudgeRooms.CreateJudgeRoomError](src/resources/judge-rooms.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.judgeRooms.createJudgeRoom(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;JudgeRoom, JudgeRooms.CreateJudgeRoomError&gt;</code>, with `result.value` of type <code>[JudgeRoom](src/models/judge-room.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>createSimulatedHold(request: JudgeRooms.CreateSimulatedHoldRequest, options?: RequestOptions): ApiPromise&lt;ApiJudgeRoomsSimHoldResponse, JudgeRooms.CreateSimulatedHoldError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.judgeRooms.createSimulatedHold({
    id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    body: { ceilingCents: 5000, name: "Asha" },
  });
  // TODO: Handle 'response' of type ApiJudgeRoomsSimHoldResponse
} catch (err) {
  // TODO: Handle 'err' of type JudgeRooms.CreateSimulatedHoldError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.judgeRooms.createSimulatedHold({
  id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
  body: { ceilingCents: 5000, name: "Asha" },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiJudgeRoomsSimHoldResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |
| <code>body</code> | <code>[ApiJudgeRoomsSimHoldRequest](src/models/api-judge-rooms-sim-hold-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.judgeRooms.createSimulatedHold(request)`

- **OnSuccess**: <code>[ApiJudgeRoomsSimHoldResponse](src/models/api-judge-rooms-sim-hold-response.ts)</code>
- **OnError**: throws <code>[JudgeRooms.CreateSimulatedHoldError](src/resources/judge-rooms.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.judgeRooms.createSimulatedHold(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiJudgeRoomsSimHoldResponse, JudgeRooms.CreateSimulatedHoldError&gt;</code>, with `result.value` of type <code>[ApiJudgeRoomsSimHoldResponse](src/models/api-judge-rooms-sim-hold-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getJudgeCapabilities(options?: RequestOptions): ApiPromise&lt;ApiJudgeCapabilitiesResponse, JudgeRooms.GetJudgeCapabilitiesError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

No credential. Tells a client whether it can create a room right now.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.judgeRooms.getJudgeCapabilities();
  // TODO: Handle 'response' of type ApiJudgeCapabilitiesResponse
} catch (err) {
  // TODO: Handle 'err' of type JudgeRooms.GetJudgeCapabilitiesError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.judgeRooms.getJudgeCapabilities().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiJudgeCapabilitiesResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.judgeRooms.getJudgeCapabilities()`

- **OnSuccess**: <code>[ApiJudgeCapabilitiesResponse](src/models/api-judge-capabilities-response.ts)</code>
- **OnError**: throws <code>[JudgeRooms.GetJudgeCapabilitiesError](src/resources/judge-rooms.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.judgeRooms.getJudgeCapabilities().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiJudgeCapabilitiesResponse, JudgeRooms.GetJudgeCapabilitiesError&gt;</code>, with `result.value` of type <code>[ApiJudgeCapabilitiesResponse](src/models/api-judge-capabilities-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getJudgeRoomLedger(request: JudgeRooms.GetJudgeRoomLedgerRequest, options?: RequestOptions): ApiPromise&lt;ReplayBundle, JudgeRooms.GetJudgeRoomLedgerError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.judgeRooms.getJudgeRoomLedger({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
  // TODO: Handle 'response' of type ReplayBundle
} catch (err) {
  // TODO: Handle 'err' of type JudgeRooms.GetJudgeRoomLedgerError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.judgeRooms.getJudgeRoomLedger({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ReplayBundle
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.judgeRooms.getJudgeRoomLedger(request)`

- **OnSuccess**: <code>[ReplayBundle](src/models/replay-bundle.ts)</code>
- **OnError**: throws <code>[JudgeRooms.GetJudgeRoomLedgerError](src/resources/judge-rooms.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.judgeRooms.getJudgeRoomLedger(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ReplayBundle, JudgeRooms.GetJudgeRoomLedgerError&gt;</code>, with `result.value` of type <code>[ReplayBundle](src/models/replay-bundle.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>joinJudgeRoom(request: JudgeRooms.JoinJudgeRoomRequest, options?: RequestOptions): ApiPromise&lt;ApiJudgeJoinResponse, JudgeRooms.JoinJudgeRoomError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.judgeRooms.joinJudgeRoom({
    body: { code: "gvl-k7m 2qx", displayName: "Asha" },
  });
  // TODO: Handle 'response' of type ApiJudgeJoinResponse
} catch (err) {
  // TODO: Handle 'err' of type JudgeRooms.JoinJudgeRoomError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.judgeRooms.joinJudgeRoom({
  body: { code: "gvl-k7m 2qx", displayName: "Asha" },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiJudgeJoinResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiJudgeJoinRequest](src/models/api-judge-join-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.judgeRooms.joinJudgeRoom(request)`

- **OnSuccess**: <code>[ApiJudgeJoinResponse](src/models/api-judge-join-response.ts)</code>
- **OnError**: throws <code>[JudgeRooms.JoinJudgeRoomError](src/resources/judge-rooms.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.judgeRooms.joinJudgeRoom(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiJudgeJoinResponse, JudgeRooms.JoinJudgeRoomError&gt;</code>, with `result.value` of type <code>[ApiJudgeJoinResponse](src/models/api-judge-join-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>listJudgeKeys(options?: RequestOptions): ApiPromise&lt;ApiJudgeKeysResponse, JudgeRooms.ListJudgeKeysError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only (`X-Admin-Key`). Lists every judge key by id with its label, limits and
state. The secret and its hash are never returned. A judge key on this route is 401.


</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.judgeRooms.listJudgeKeys();
  // TODO: Handle 'response' of type ApiJudgeKeysResponse
} catch (err) {
  // TODO: Handle 'err' of type JudgeRooms.ListJudgeKeysError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.judgeRooms.listJudgeKeys().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiJudgeKeysResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.judgeRooms.listJudgeKeys()`

- **OnSuccess**: <code>[ApiJudgeKeysResponse](src/models/api-judge-keys-response.ts)</code>
- **OnError**: throws <code>[JudgeRooms.ListJudgeKeysError](src/resources/judge-rooms.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.judgeRooms.listJudgeKeys().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiJudgeKeysResponse, JudgeRooms.ListJudgeKeysError&gt;</code>, with `result.value` of type <code>[ApiJudgeKeysResponse](src/models/api-judge-keys-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>pauseJudgeRooms(request: JudgeRooms.PauseJudgeRoomsRequest, options?: RequestOptions): ApiPromise&lt;ApiJudgePauseResponse, JudgeRooms.PauseJudgeRoomsError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. A global kill switch for the create route; the flag survives a restart.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.judgeRooms.pauseJudgeRooms({ body: { paused: true } });
  // TODO: Handle 'response' of type ApiJudgePauseResponse
} catch (err) {
  // TODO: Handle 'err' of type JudgeRooms.PauseJudgeRoomsError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.judgeRooms.pauseJudgeRooms({ body: { paused: true } }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiJudgePauseResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiJudgePauseRequest](src/models/api-judge-pause-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.judgeRooms.pauseJudgeRooms(request)`

- **OnSuccess**: <code>[ApiJudgePauseResponse](src/models/api-judge-pause-response.ts)</code>
- **OnError**: throws <code>[JudgeRooms.PauseJudgeRoomsError](src/resources/judge-rooms.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.judgeRooms.pauseJudgeRooms(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiJudgePauseResponse, JudgeRooms.PauseJudgeRoomsError&gt;</code>, with `result.value` of type <code>[ApiJudgePauseResponse](src/models/api-judge-pause-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>placeJudgeBid(request: JudgeRooms.PlaceJudgeBidRequest, options?: RequestOptions): ApiPromise&lt;ApiJudgeRoomsBidsResponse, JudgeRooms.PlaceJudgeBidError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.judgeRooms.placeJudgeBid({
    id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
    body: { amount: 1500 },
  });
  // TODO: Handle 'response' of type ApiJudgeRoomsBidsResponse
} catch (err) {
  // TODO: Handle 'err' of type JudgeRooms.PlaceJudgeBidError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.judgeRooms.placeJudgeBid({
  id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5",
  body: { amount: 1500 },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiJudgeRoomsBidsResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |
| <code>body</code> | <code>[ApiJudgeRoomsBidsRequest](src/models/api-judge-rooms-bids-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.judgeRooms.placeJudgeBid(request)`

- **OnSuccess**: <code>[ApiJudgeRoomsBidsResponse](src/models/api-judge-rooms-bids-response.ts)</code>
- **OnError**: throws <code>[JudgeRooms.PlaceJudgeBidError](src/resources/judge-rooms.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.judgeRooms.placeJudgeBid(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiJudgeRoomsBidsResponse, JudgeRooms.PlaceJudgeBidError&gt;</code>, with `result.value` of type <code>[ApiJudgeRoomsBidsResponse](src/models/api-judge-rooms-bids-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>revokeJudgeKey(request: JudgeRooms.RevokeJudgeKeyRequest, options?: RequestOptions): ApiPromise&lt;ApiJudgeKeysRevokeResponse, JudgeRooms.RevokeJudgeKeyError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.judgeRooms.revokeJudgeKey({ keyId: "some example string" });
  // TODO: Handle 'response' of type ApiJudgeKeysRevokeResponse
} catch (err) {
  // TODO: Handle 'err' of type JudgeRooms.RevokeJudgeKeyError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.judgeRooms.revokeJudgeKey({ keyId: "some example string" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiJudgeKeysRevokeResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>keyId</code> | <code>string</code> | The 8 character id inside the key (`gvl_judge_<id>_<secret>`), or `legacy`. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.judgeRooms.revokeJudgeKey(request)`

- **OnSuccess**: <code>[ApiJudgeKeysRevokeResponse](src/models/api-judge-keys-revoke-response.ts)</code>
- **OnError**: throws <code>[JudgeRooms.RevokeJudgeKeyError](src/resources/judge-rooms.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.judgeRooms.revokeJudgeKey(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiJudgeKeysRevokeResponse, JudgeRooms.RevokeJudgeKeyError&gt;</code>, with `result.value` of type <code>[ApiJudgeKeysRevokeResponse](src/models/api-judge-keys-revoke-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Export

> Source: [Export](src/resources/export.ts)

<details>
<summary><code>adminExport(request?: Export.AdminExportRequest, options?: RequestOptions): ApiPromise&lt;undefined, Export.AdminExportError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  await client.export.adminExport({ list: List._1, kind: Kind.Payments });
} catch (err) {
  // TODO: Handle 'err' of type Export.AdminExportError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.export.adminExport({ list: List._1, kind: Kind.Payments }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: The call succeeded and resolves to no body
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>auction?</code> | <code>string</code> | Auction id (`auctionId` is accepted as an alias). |
| <code>list?</code> | <code>[List](src/models/list.ts)</code> | Send `1` to list every auction id instead of exporting one auction. |
| <code>kind?</code> | <code>[Kind](src/models/kind.ts)</code> | Which export to return. Without it, `auction` returns the ledger. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.export.adminExport(request)`

- **OnSuccess**: <code>undefined</code>
- **OnError**: throws <code>[Export.AdminExportError](src/resources/export.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.export.adminExport(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;undefined, Export.AdminExportError&gt;</code>, with `result.value` of type <code>undefined</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>adminReplayBundle(request: Export.AdminReplayBundleRequest, options?: RequestOptions): ApiPromise&lt;Record&lt;string, unknown&gt;, Export.AdminReplayBundleError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. A self-contained bundle of the auction's ledger for replay and
verification. Query `auctionId` is required. 409 when the hash chain is broken.


</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.export.adminReplayBundle({ auctionId: "01J9ZZ0000000000000000000A" });
  // TODO: Handle 'response' of type Record<string, unknown>
} catch (err) {
  // TODO: Handle 'err' of type Export.AdminReplayBundleError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.export.adminReplayBundle({
  auctionId: "01J9ZZ0000000000000000000A",
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Record<string, unknown>
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>auctionId</code> | <code>string</code> | Id of the auction to bundle. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.export.adminReplayBundle(request)`

- **OnSuccess**: <code>Record&lt;string, unknown&gt;</code>
- **OnError**: throws <code>[Export.AdminReplayBundleError](src/resources/export.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.export.adminReplayBundle(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Record&lt;string, unknown&gt;, Export.AdminReplayBundleError&gt;</code>, with `result.value` of type <code>Record&lt;string, unknown&gt;</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>exportEvents(request: Export.ExportEventsRequest, options?: RequestOptions): ApiPromise&lt;undefined, Export.ExportEventsError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  await client.export.exportEvents({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
} catch (err) {
  // TODO: Handle 'err' of type Export.ExportEventsError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.export.exportEvents({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: The call succeeded and resolves to no body
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.export.exportEvents(request)`

- **OnSuccess**: <code>undefined</code>
- **OnError**: throws <code>[Export.ExportEventsError](src/resources/export.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.export.exportEvents(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;undefined, Export.ExportEventsError&gt;</code>, with `result.value` of type <code>undefined</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getJudgeRoomLedger(request: Export.GetJudgeRoomLedgerRequest, options?: RequestOptions): ApiPromise&lt;ReplayBundle, Export.GetJudgeRoomLedgerError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.export.getJudgeRoomLedger({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
  // TODO: Handle 'response' of type ReplayBundle
} catch (err) {
  // TODO: Handle 'err' of type Export.GetJudgeRoomLedgerError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.export.getJudgeRoomLedger({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ReplayBundle
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.export.getJudgeRoomLedger(request)`

- **OnSuccess**: <code>[ReplayBundle](src/models/replay-bundle.ts)</code>
- **OnError**: throws <code>[Export.GetJudgeRoomLedgerError](src/resources/export.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.export.getJudgeRoomLedger(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ReplayBundle, Export.GetJudgeRoomLedgerError&gt;</code>, with `result.value` of type <code>[ReplayBundle](src/models/replay-bundle.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Operator

> Source: [Operator](src/resources/operator.ts)

<details>
<summary><code>adminExport(request?: Operator.AdminExportRequest, options?: RequestOptions): ApiPromise&lt;undefined, Operator.AdminExportError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  await client.operator.adminExport({ list: List._1, kind: Kind.Payments });
} catch (err) {
  // TODO: Handle 'err' of type Operator.AdminExportError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.adminExport({ list: List._1, kind: Kind.Payments }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: The call succeeded and resolves to no body
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>auction?</code> | <code>string</code> | Auction id (`auctionId` is accepted as an alias). |
| <code>list?</code> | <code>[List](src/models/list.ts)</code> | Send `1` to list every auction id instead of exporting one auction. |
| <code>kind?</code> | <code>[Kind](src/models/kind.ts)</code> | Which export to return. Without it, `auction` returns the ledger. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.adminExport(request)`

- **OnSuccess**: <code>undefined</code>
- **OnError**: throws <code>[Operator.AdminExportError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.adminExport(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;undefined, Operator.AdminExportError&gt;</code>, with `result.value` of type <code>undefined</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>adminReplayBundle(request: Operator.AdminReplayBundleRequest, options?: RequestOptions): ApiPromise&lt;Record&lt;string, unknown&gt;, Operator.AdminReplayBundleError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. A self-contained bundle of the auction's ledger for replay and
verification. Query `auctionId` is required. 409 when the hash chain is broken.


</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.adminReplayBundle({ auctionId: "01J9ZZ0000000000000000000A" });
  // TODO: Handle 'response' of type Record<string, unknown>
} catch (err) {
  // TODO: Handle 'err' of type Operator.AdminReplayBundleError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.adminReplayBundle({
  auctionId: "01J9ZZ0000000000000000000A",
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Record<string, unknown>
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>auctionId</code> | <code>string</code> | Id of the auction to bundle. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.adminReplayBundle(request)`

- **OnSuccess**: <code>Record&lt;string, unknown&gt;</code>
- **OnError**: throws <code>[Operator.AdminReplayBundleError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.adminReplayBundle(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Record&lt;string, unknown&gt;, Operator.AdminReplayBundleError&gt;</code>, with `result.value` of type <code>Record&lt;string, unknown&gt;</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getMetrics(options?: RequestOptions): ApiPromise&lt;Record&lt;string, unknown&gt;, Operator.GetMetricsError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only: this route is not public. Own limit of 60 requests per minute on top of
the host-wide limit.


</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.getMetrics();
  // TODO: Handle 'response' of type Record<string, unknown>
} catch (err) {
  // TODO: Handle 'err' of type Operator.GetMetricsError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.getMetrics().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Record<string, unknown>
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.getMetrics()`

- **OnSuccess**: <code>Record&lt;string, unknown&gt;</code>
- **OnError**: throws <code>[Operator.GetMetricsError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.getMetrics().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Record&lt;string, unknown&gt;, Operator.GetMetricsError&gt;</code>, with `result.value` of type <code>Record&lt;string, unknown&gt;</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getMetricsPrometheus(options?: RequestOptions): ApiPromise&lt;string, Operator.GetMetricsPrometheusError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.getMetricsPrometheus();
  // TODO: Handle 'response' of type string
} catch (err) {
  // TODO: Handle 'err' of type Operator.GetMetricsPrometheusError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.getMetricsPrometheus().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type string
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.getMetricsPrometheus()`

- **OnSuccess**: <code>string</code>
- **OnError**: throws <code>[Operator.GetMetricsPrometheusError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.getMetricsPrometheus().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;string, Operator.GetMetricsPrometheusError&gt;</code>, with `result.value` of type <code>string</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getOpsSummary(options?: RequestOptions): ApiPromise&lt;OpsSummaryResponse, Operator.GetOpsSummaryError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. Recent logs, settlement sagas, PayPal webhook outcomes and metrics.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.getOpsSummary();
  // TODO: Handle 'response' of type OpsSummaryResponse
} catch (err) {
  // TODO: Handle 'err' of type Operator.GetOpsSummaryError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.getOpsSummary().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type OpsSummaryResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.getOpsSummary()`

- **OnSuccess**: <code>[OpsSummaryResponse](src/models/ops-summary-response.ts)</code>
- **OnError**: throws <code>[Operator.GetOpsSummaryError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.getOpsSummary().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;OpsSummaryResponse, Operator.GetOpsSummaryError&gt;</code>, with `result.value` of type <code>[OpsSummaryResponse](src/models/ops-summary-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>listJudgeKeys(options?: RequestOptions): ApiPromise&lt;ApiJudgeKeysResponse, Operator.ListJudgeKeysError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only (`X-Admin-Key`). Lists every judge key by id with its label, limits and
state. The secret and its hash are never returned. A judge key on this route is 401.


</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.listJudgeKeys();
  // TODO: Handle 'response' of type ApiJudgeKeysResponse
} catch (err) {
  // TODO: Handle 'err' of type Operator.ListJudgeKeysError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.listJudgeKeys().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiJudgeKeysResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.listJudgeKeys()`

- **OnSuccess**: <code>[ApiJudgeKeysResponse](src/models/api-judge-keys-response.ts)</code>
- **OnError**: throws <code>[Operator.ListJudgeKeysError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.listJudgeKeys().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiJudgeKeysResponse, Operator.ListJudgeKeysError&gt;</code>, with `result.value` of type <code>[ApiJudgeKeysResponse](src/models/api-judge-keys-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>listOpsRooms(options?: RequestOptions): ApiPromise&lt;OpsRoomsResponse, Operator.ListOpsRoomsError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.listOpsRooms();
  // TODO: Handle 'response' of type OpsRoomsResponse
} catch (err) {
  // TODO: Handle 'err' of type Operator.ListOpsRoomsError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.listOpsRooms().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type OpsRoomsResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.listOpsRooms()`

- **OnSuccess**: <code>[OpsRoomsResponse](src/models/ops-rooms-response.ts)</code>
- **OnError**: throws <code>[Operator.ListOpsRoomsError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.listOpsRooms().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;OpsRoomsResponse, Operator.ListOpsRoomsError&gt;</code>, with `result.value` of type <code>[OpsRoomsResponse](src/models/ops-rooms-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>opsReleaseReview(request: Operator.OpsReleaseReviewRequest, options?: RequestOptions): ApiPromise&lt;OpsAuctionsReleaseReviewResponse, Operator.OpsReleaseReviewError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. Releases the fallback candidates' holds of a settlement in review.
409 with `busy`, `no_settlement` or `not_in_review`.


</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.opsReleaseReview({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
  // TODO: Handle 'response' of type OpsAuctionsReleaseReviewResponse
} catch (err) {
  // TODO: Handle 'err' of type Operator.OpsReleaseReviewError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.opsReleaseReview({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type OpsAuctionsReleaseReviewResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.opsReleaseReview(request)`

- **OnSuccess**: <code>[OpsAuctionsReleaseReviewResponse](src/models/ops-auctions-release-review-response.ts)</code>
- **OnError**: throws <code>[Operator.OpsReleaseReviewError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.opsReleaseReview(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;OpsAuctionsReleaseReviewResponse, Operator.OpsReleaseReviewError&gt;</code>, with `result.value` of type <code>[OpsAuctionsReleaseReviewResponse](src/models/ops-auctions-release-review-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>opsVoidAll(request: Operator.OpsVoidAllRequest, options?: RequestOptions): ApiPromise&lt;OpsAuctionsVoidAllResponse, Operator.OpsVoidAllError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.opsVoidAll({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
  // TODO: Handle 'response' of type OpsAuctionsVoidAllResponse
} catch (err) {
  // TODO: Handle 'err' of type Operator.OpsVoidAllError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.opsVoidAll({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type OpsAuctionsVoidAllResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.opsVoidAll(request)`

- **OnSuccess**: <code>[OpsAuctionsVoidAllResponse](src/models/ops-auctions-void-all-response.ts)</code>
- **OnError**: throws <code>[Operator.OpsVoidAllError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.opsVoidAll(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;OpsAuctionsVoidAllResponse, Operator.OpsVoidAllError&gt;</code>, with `result.value` of type <code>[OpsAuctionsVoidAllResponse](src/models/ops-auctions-void-all-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>pauseJudgeRooms(request: Operator.PauseJudgeRoomsRequest, options?: RequestOptions): ApiPromise&lt;ApiJudgePauseResponse, Operator.PauseJudgeRoomsError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Operator only. A global kill switch for the create route; the flag survives a restart.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.pauseJudgeRooms({ body: { paused: true } });
  // TODO: Handle 'response' of type ApiJudgePauseResponse
} catch (err) {
  // TODO: Handle 'err' of type Operator.PauseJudgeRoomsError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.pauseJudgeRooms({ body: { paused: true } }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiJudgePauseResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiJudgePauseRequest](src/models/api-judge-pause-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.pauseJudgeRooms(request)`

- **OnSuccess**: <code>[ApiJudgePauseResponse](src/models/api-judge-pause-response.ts)</code>
- **OnError**: throws <code>[Operator.PauseJudgeRoomsError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.pauseJudgeRooms(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiJudgePauseResponse, Operator.PauseJudgeRoomsError&gt;</code>, with `result.value` of type <code>[ApiJudgePauseResponse](src/models/api-judge-pause-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>revokeJudgeKey(request: Operator.RevokeJudgeKeyRequest, options?: RequestOptions): ApiPromise&lt;ApiJudgeKeysRevokeResponse, Operator.RevokeJudgeKeyError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.revokeJudgeKey({ keyId: "some example string" });
  // TODO: Handle 'response' of type ApiJudgeKeysRevokeResponse
} catch (err) {
  // TODO: Handle 'err' of type Operator.RevokeJudgeKeyError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.revokeJudgeKey({ keyId: "some example string" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiJudgeKeysRevokeResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>keyId</code> | <code>string</code> | The 8 character id inside the key (`gvl_judge_<id>_<secret>`), or `legacy`. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.revokeJudgeKey(request)`

- **OnSuccess**: <code>[ApiJudgeKeysRevokeResponse](src/models/api-judge-keys-revoke-response.ts)</code>
- **OnError**: throws <code>[Operator.RevokeJudgeKeyError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.revokeJudgeKey(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiJudgeKeysRevokeResponse, Operator.RevokeJudgeKeyError&gt;</code>, with `result.value` of type <code>[ApiJudgeKeysRevokeResponse](src/models/api-judge-keys-revoke-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Receipts

> Source: [Receipts](src/resources/receipts.ts)

<details>
<summary><code>createReceiptLink(request: Receipts.CreateReceiptLinkRequest, options?: RequestOptions): ApiPromise&lt;ApiAuctionsReceiptLinkResponse, Receipts.CreateReceiptLinkError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Session token only. Returns a receipt token (valid 4 hours) that opens exactly one
read-only route, `GET /api/auctions/{id}/receipt`, for this bidder.


</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.receipts.createReceiptLink({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
  // TODO: Handle 'response' of type ApiAuctionsReceiptLinkResponse
} catch (err) {
  // TODO: Handle 'err' of type Receipts.CreateReceiptLinkError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.receipts.createReceiptLink({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiAuctionsReceiptLinkResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.receipts.createReceiptLink(request)`

- **OnSuccess**: <code>[ApiAuctionsReceiptLinkResponse](src/models/api-auctions-receipt-link-response.ts)</code>
- **OnError**: throws <code>[Receipts.CreateReceiptLinkError](src/resources/receipts.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.receipts.createReceiptLink(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiAuctionsReceiptLinkResponse, Receipts.CreateReceiptLinkError&gt;</code>, with `result.value` of type <code>[ApiAuctionsReceiptLinkResponse](src/models/api-auctions-receipt-link-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getReceipt(request: Receipts.GetReceiptRequest, options?: RequestOptions): ApiPromise&lt;ApiAuctionsReceiptResponse, Receipts.GetReceiptError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.receipts.getReceipt({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" });
  // TODO: Handle 'response' of type ApiAuctionsReceiptResponse
} catch (err) {
  // TODO: Handle 'err' of type Receipts.GetReceiptError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.receipts.getReceipt({ id: "01JC5ZP4M7Q8R9S0T1V2W3X4Y5" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiAuctionsReceiptResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | Auction id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.receipts.getReceipt(request)`

- **OnSuccess**: <code>[ApiAuctionsReceiptResponse](src/models/api-auctions-receipt-response.ts)</code>
- **OnError**: throws <code>[Receipts.GetReceiptError](src/resources/receipts.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.receipts.getReceipt(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiAuctionsReceiptResponse, Receipts.GetReceiptError&gt;</code>, with `result.value` of type <code>[ApiAuctionsReceiptResponse](src/models/api-auctions-receipt-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Health

> Source: [Health](src/resources/health.ts)

<details>
<summary><code>getHealth(options?: RequestOptions): ApiPromise&lt;Status, ApiError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Always 200 while the process runs. Never rate limited.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.health.getHealth();
  // TODO: Handle 'response' of type Status
} catch (err) {
  // TODO: Handle 'err' of type ApiError, where 'err.payload' is always the Undeclared arm
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.health.getHealth().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Status
} else {
  // TODO: Handle 'result', where 'result.payload' is always the Undeclared arm
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.health.getHealth()`

- **OnSuccess**: <code>[Status](src/models/status.ts)</code>
- **OnError**: throws <code>[ApiError](src/core/api-error.ts)</code>, with `err.payload` always the <code>[Undeclared](src/core/api-error.ts)</code> arm

**As ApiResult**: `await client.health.getHealth().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Status, ApiError&gt;</code>, with `result.value` of type <code>[Status](src/models/status.ts)</code>
- **OnError**: `result.payload` always the <code>[Undeclared](src/core/api-error.ts)</code> arm, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getReadiness(options?: RequestOptions): ApiPromise&lt;Status, Health.GetReadinessError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

200 when every migration is applied and the store answers; 503 otherwise. Never rate limited.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.health.getReadiness();
  // TODO: Handle 'response' of type Status
} catch (err) {
  // TODO: Handle 'err' of type Health.GetReadinessError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.health.getReadiness().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Status
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.health.getReadiness()`

- **OnSuccess**: <code>[Status](src/models/status.ts)</code>
- **OnError**: throws <code>[Health.GetReadinessError](src/resources/health.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.health.getReadiness().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Status, Health.GetReadinessError&gt;</code>, with `result.value` of type <code>[Status](src/models/status.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getVersion(options?: RequestOptions): ApiPromise&lt;VersionResponse, ApiError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

The commit the running build was made from, or `unknown`. Never rate limited.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.health.getVersion();
  // TODO: Handle 'response' of type VersionResponse
} catch (err) {
  // TODO: Handle 'err' of type ApiError, where 'err.payload' is always the Undeclared arm
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.health.getVersion().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type VersionResponse
} else {
  // TODO: Handle 'result', where 'result.payload' is always the Undeclared arm
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.health.getVersion()`

- **OnSuccess**: <code>[VersionResponse](src/models/version-response.ts)</code>
- **OnError**: throws <code>[ApiError](src/core/api-error.ts)</code>, with `err.payload` always the <code>[Undeclared](src/core/api-error.ts)</code> arm

**As ApiResult**: `await client.health.getVersion().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;VersionResponse, ApiError&gt;</code>, with `result.value` of type <code>[VersionResponse](src/models/version-response.ts)</code>
- **OnError**: `result.payload` always the <code>[Undeclared](src/core/api-error.ts)</code> arm, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>warmup(options?: RequestOptions): ApiPromise&lt;WarmupReport, Health.WarmupError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

No credential. Runs the warm-up steps in parallel within a 3 second budget; 200 when all are warm, 503 otherwise.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.health.warmup();
  // TODO: Handle 'response' of type WarmupReport
} catch (err) {
  // TODO: Handle 'err' of type Health.WarmupError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.health.warmup().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type WarmupReport
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.health.warmup()`

- **OnSuccess**: <code>[WarmupReport](src/models/warmup-report.ts)</code>
- **OnError**: throws <code>[Health.WarmupError](src/resources/health.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.health.warmup().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;WarmupReport, Health.WarmupError&gt;</code>, with `result.value` of type <code>[WarmupReport](src/models/warmup-report.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GavelHostApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

