<!-- Generated file — do not edit; regenerated with the SDK. -->

# Control — operations

Accessor: `client.control` · Source: `gavel_host_api/apis/control.py` · 2 operations

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.control.control_auction

- **Route**: `POST /api/auctions/{id}/control`
- **Auth**: `auctioneer_auth`
- **Signature**: `def control_auction(id_: str, body: ControlRequest | ControlRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`, `body`
- **Params**: `id_` — path `id` · `body` — JSON body
- **Returns (parsed)**: `ControlResponse`
- **Returns (raw)**: `ApiResult[ControlResponse, ControlAuctionErrorBody]`
- **Error**: `ControlAuctionErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 403, 404, 409, 413, 415, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ControlRequest` | `gavel_host_api/models/control_request.py` |
| `ControlRequestDict` | `gavel_host_api/models/control_request.py` |
| `ControlResponse` | `gavel_host_api/models/control_response.py` |
| `ControlAuctionErrorBody` | `gavel_host_api/errors/control_auction_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.control.kill_auction

- **Route**: `POST /api/auctions/{id}/kill`
- **Auth**: `auctioneer_auth`
- **Signature**: `def kill_auction(id_: str, body: ApiAuctionsKillRequest | ApiAuctionsKillRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`, `body`
- **Params**: `id_` — path `id` · `body` — JSON body
- **Returns (parsed)**: `ApiAuctionsKillResponse`
- **Returns (raw)**: `ApiResult[ApiAuctionsKillResponse, KillAuctionErrorBody]`
- **Error**: `KillAuctionErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 403, 404, 413, 415, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiAuctionsKillRequest` | `gavel_host_api/models/api_auctions_kill_request.py` |
| `ApiAuctionsKillRequestDict` | `gavel_host_api/models/api_auctions_kill_request.py` |
| `ApiAuctionsKillResponse` | `gavel_host_api/models/api_auctions_kill_response.py` |
| `KillAuctionErrorBody` | `gavel_host_api/errors/kill_auction_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

