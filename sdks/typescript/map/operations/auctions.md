<!-- Generated file — do not edit; regenerated with the SDK. -->

# Auctions — operations

Accessor: `client.auctions` · Source: `src/resources/auctions.ts` · 5 operations · Request and error types: namespace `Auctions`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `gavel-sdk`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### createAuction

- **Signature**: `createAuction(request: Auctions.CreateAuctionRequestParams, options?: RequestOptions): ApiPromise<CreateAuctionResponse, Auctions.CreateAuctionError>`
- **Wire**: `POST /api/auctions`
- **Auth**: `adminKey`
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `CreateAuctionResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Auctions.CreateAuctionError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [413] `Error5` · `"error54"` [415] `Error5` · `"error55"` [429] `Error5` · `"error56"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Auctions.CreateAuctionRequestParams` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `CreateAuctionRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `CreateAuctionRequest` | `createAuctionRequestSchema` | `src/models/create-auction-request.ts` |
| `CreateAuctionResponse` | `createAuctionResponseSchema` | `src/models/create-auction-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### getAuction

- **Signature**: `getAuction(request: Auctions.GetAuctionRequest, options?: RequestOptions): ApiPromise<AuctionPublic, Auctions.GetAuctionError>`
- **Wire**: `GET /api/auctions/{id}`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `AuctionPublic`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Auctions.GetAuctionError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [404] `Error5` · `"error52"` [429] `Error5` · `"error53"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Auctions.GetAuctionRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `AuctionPublic` | `auctionPublicSchema` | `src/models/auction-public.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### revokeAllAuctioneerTokens

- **Signature**: `revokeAllAuctioneerTokens(request: Auctions.RevokeAllAuctioneerTokensRequest, options?: RequestOptions): ApiPromise<Revoked, Auctions.RevokeAllAuctioneerTokensError>`
- **Wire**: `POST /api/auctions/{id}/auctioneer/revoke-all`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `Revoked`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Auctions.RevokeAllAuctioneerTokensError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [404] `Error5` · `"error53"` [429] `Error5` · `"error54"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Auctions.RevokeAllAuctioneerTokensRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `Revoked` | `revokedSchema` | `src/models/revoked.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### revokeAuctioneerToken

- **Signature**: `revokeAuctioneerToken(request: Auctions.RevokeAuctioneerTokenRequest, options?: RequestOptions): ApiPromise<Revoked, Auctions.RevokeAuctioneerTokenError>`
- **Wire**: `POST /api/auctions/{id}/auctioneer/revoke`
- **Auth**: `adminKey`
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `Revoked`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Auctions.RevokeAuctioneerTokenError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [404] `Error5` · `"error54"` [413] `Error5` · `"error55"` [415] `Error5` · `"error56"` [429] `Error5` · `"error57"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Auctions.RevokeAuctioneerTokenRequest` (2):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |
| `body` | `body` | `ApiAuctionsAuctioneerRevokeRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiAuctionsAuctioneerRevokeRequest` | `apiAuctionsAuctioneerRevokeRequestSchema` | `src/models/api-auctions-auctioneer-revoke-request.ts` |
| `Revoked` | `revokedSchema` | `src/models/revoked.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### rotateAuctioneerToken

- **Signature**: `rotateAuctioneerToken(request: Auctions.RotateAuctioneerTokenRequest, options?: RequestOptions): ApiPromise<ApiAuctionsAuctioneerRotateResponse, Auctions.RotateAuctioneerTokenError>`
- **Wire**: `POST /api/auctions/{id}/auctioneer/rotate`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiAuctionsAuctioneerRotateResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Auctions.RotateAuctioneerTokenError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [404] `Error5` · `"error53"` [429] `Error5` · `"error54"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Auctions.RotateAuctioneerTokenRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiAuctionsAuctioneerRotateResponse` | `apiAuctionsAuctioneerRotateResponseSchema` | `src/models/api-auctions-auctioneer-rotate-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

