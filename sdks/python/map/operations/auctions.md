<!-- Generated file — do not edit; regenerated with the SDK. -->

# Auctions — operations

Accessor: `client.auctions` · Source: `gavel_host_api/apis/auctions.py` · 5 operations

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.auctions.create_auction

- **Route**: `POST /api/auctions`
- **Auth**: `admin_key`
- **Signature**: `def create_auction(body: CreateAuctionRequest | CreateAuctionRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `body`
- **Params**: `body` — JSON body
- **Returns (parsed)**: `CreateAuctionResponse`
- **Returns (raw)**: `ApiResult[CreateAuctionResponse, CreateAuctionErrorBody]`
- **Error**: `CreateAuctionErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 413, 415, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `CreateAuctionRequest` | `gavel_host_api/models/create_auction_request.py` |
| `CreateAuctionRequestDict` | `gavel_host_api/models/create_auction_request.py` |
| `CreateAuctionResponse` | `gavel_host_api/models/create_auction_response.py` |
| `CreateAuctionErrorBody` | `gavel_host_api/errors/create_auction_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.auctions.get_auction

- **Route**: `GET /api/auctions/{id}`
- **Signature**: `def get_auction(id_: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id`
- **Returns (parsed)**: `AuctionPublic`
- **Returns (raw)**: `ApiResult[AuctionPublic, GetAuctionErrorBody]`
- **Error**: `GetAuctionErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [404, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `AuctionPublic` | `gavel_host_api/models/auction_public.py` |
| `GetAuctionErrorBody` | `gavel_host_api/errors/get_auction_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.auctions.revoke_all_auctioneer_tokens

- **Route**: `POST /api/auctions/{id}/auctioneer/revoke-all`
- **Auth**: `admin_key`
- **Signature**: `def revoke_all_auctioneer_tokens(id_: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id`
- **Returns (parsed)**: `Revoked`
- **Returns (raw)**: `ApiResult[Revoked, RevokeAllAuctioneerTokensErrorBody]`
- **Error**: `RevokeAllAuctioneerTokensErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 404, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `Revoked` | `gavel_host_api/models/revoked.py` |
| `RevokeAllAuctioneerTokensErrorBody` | `gavel_host_api/errors/revoke_all_auctioneer_tokens_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.auctions.revoke_auctioneer_token

- **Route**: `POST /api/auctions/{id}/auctioneer/revoke`
- **Auth**: `admin_key`
- **Signature**: `def revoke_auctioneer_token(id_: str, body: ApiAuctionsAuctioneerRevokeRequest | ApiAuctionsAuctioneerRevokeRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`, `body`
- **Params**: `id_` — path `id` · `body` — JSON body
- **Returns (parsed)**: `Revoked`
- **Returns (raw)**: `ApiResult[Revoked, RevokeAuctioneerTokenErrorBody]`
- **Error**: `RevokeAuctioneerTokenErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 404, 413, 415, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiAuctionsAuctioneerRevokeRequest` | `gavel_host_api/models/api_auctions_auctioneer_revoke_request.py` |
| `ApiAuctionsAuctioneerRevokeRequestDict` | `gavel_host_api/models/api_auctions_auctioneer_revoke_request.py` |
| `Revoked` | `gavel_host_api/models/revoked.py` |
| `RevokeAuctioneerTokenErrorBody` | `gavel_host_api/errors/revoke_auctioneer_token_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.auctions.rotate_auctioneer_token

- **Route**: `POST /api/auctions/{id}/auctioneer/rotate`
- **Auth**: `admin_key`
- **Signature**: `def rotate_auctioneer_token(id_: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id`
- **Returns (parsed)**: `ApiAuctionsAuctioneerRotateResponse`
- **Returns (raw)**: `ApiResult[ApiAuctionsAuctioneerRotateResponse, RotateAuctioneerTokenErrorBody]`
- **Error**: `RotateAuctioneerTokenErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 404, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiAuctionsAuctioneerRotateResponse` | `gavel_host_api/models/api_auctions_auctioneer_rotate_response.py` |
| `RotateAuctioneerTokenErrorBody` | `gavel_host_api/errors/rotate_auctioneer_token_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

