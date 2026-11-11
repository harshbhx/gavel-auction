<!-- Generated file — do not edit; regenerated with the SDK. -->

# Export — operations

Accessor: `client.export` · Source: `gavel_host_api/apis/export.py` · 4 operations

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.export.admin_export

- **Route**: `GET /admin/export`
- **Auth**: `admin_key`
- **Signature**: `def admin_export(*, auction: str | None = None, list_: ListOrStr | None = None, kind: KindOrStr | None = None, request_options: RequestOptionsOrDict | None = None)`
- **Params**: `auction` — query · `list_` — query `list` · `kind` — query
- **Returns (parsed)**: `None`
- **Returns (raw)**: `ApiResult[None, AdminExportErrorBody]`
- **Error**: `AdminExportErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 404, 405, 429, 500, 501] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ListOrStr` | `gavel_host_api/models/enums/list.py` |
| `KindOrStr` | `gavel_host_api/models/enums/kind.py` |
| `AdminExportErrorBody` | `gavel_host_api/errors/admin_export_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.export.admin_replay_bundle

- **Route**: `GET /admin/replay-bundle`
- **Auth**: `admin_key`
- **Signature**: `def admin_replay_bundle(auction_id: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `auction_id`
- **Params**: `auction_id` — query `auctionId`
- **Returns (parsed)**: `Any`
- **Returns (raw)**: `ApiResult[Any, AdminReplayBundleErrorBody]`
- **Error**: `AdminReplayBundleErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 404, 405, 409, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `AdminReplayBundleErrorBody` | `gavel_host_api/errors/admin_replay_bundle_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.export.export_events

- **Route**: `GET /api/auctions/{id}/export`
- **Auth**: `auctioneer_auth` OR `admin_key`
- **Signature**: `def export_events(id_: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id`
- **Returns (parsed)**: `None`
- **Returns (raw)**: `ApiResult[None, ExportEventsErrorBody]`
- **Error**: `ExportEventsErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 403, 404, 405, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ExportEventsErrorBody` | `gavel_host_api/errors/export_events_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.export.get_judge_room_ledger

- **Route**: `GET /api/judge/rooms/{id}/ledger`
- **Auth**: `reviewer_auth` OR `auctioneer_auth`
- **Signature**: `def get_judge_room_ledger(id_: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id`
- **Returns (parsed)**: `ReplayBundle`
- **Returns (raw)**: `ApiResult[ReplayBundle, GetJudgeRoomLedgerErrorBody]`
- **Error**: `GetJudgeRoomLedgerErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 404, 409, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ReplayBundle` | `gavel_host_api/models/replay_bundle.py` |
| `GetJudgeRoomLedgerErrorBody` | `gavel_host_api/errors/get_judge_room_ledger_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

