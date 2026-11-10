<!-- Generated file — do not edit; regenerated with the SDK. -->

# Read — operations

Accessor: `client.read` · Source: `gavel_host_api/apis/read.py` · 2 operations

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.read.get_snapshot

- **Route**: `GET /api/auctions/{id}/snapshot`
- **Auth**: `auctioneer_auth` OR `screen_auth` OR `session_auth` OR `reviewer_auth`
- **Signature**: `def get_snapshot(id_: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id`
- **Returns (parsed)**: `StateFrame`
- **Returns (raw)**: `ApiResult[StateFrame, GetSnapshotErrorBody]`
- **Error**: `GetSnapshotErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 403, 404, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `StateFrame` | `gavel_host_api/models/state_frame.py` |
| `GetSnapshotErrorBody` | `gavel_host_api/errors/get_snapshot_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.read.list_events

- **Route**: `GET /api/auctions/{id}/events`
- **Auth**: `auctioneer_auth` OR `screen_auth` OR `reviewer_auth`
- **Signature**: `def list_events(id_: str, *, after: int | None = 0, limit: int | None = 100, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id` · `after` — query · `limit` — query
- **Returns (parsed)**: `ApiAuctionsEventsResponse`
- **Returns (raw)**: `ApiResult[ApiAuctionsEventsResponse, ListEventsErrorBody]`
- **Error**: `ListEventsErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 404, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiAuctionsEventsResponse` | `gavel_host_api/models/api_auctions_events_response.py` |
| `ListEventsErrorBody` | `gavel_host_api/errors/list_events_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

