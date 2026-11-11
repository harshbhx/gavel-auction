<!-- Generated file — do not edit; regenerated with the SDK. -->

# Operator — operations

Accessor: `client.operator` · Source: `gavel_host_api/apis/operator.py` · 11 operations

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.operator.admin_export

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

### client.operator.admin_replay_bundle

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

### client.operator.get_metrics

- **Route**: `GET /metrics`
- **Auth**: `admin_key`
- **Signature**: `def get_metrics(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `Any`
- **Returns (raw)**: `ApiResult[Any, GetMetricsErrorBody]`
- **Error**: `GetMetricsErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 405, 429] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `GetMetricsErrorBody` | `gavel_host_api/errors/get_metrics_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.operator.get_metrics_prometheus

- **Route**: `GET /metrics/prometheus`
- **Auth**: `admin_key`
- **Signature**: `def get_metrics_prometheus(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `str`
- **Returns (raw)**: `ApiResult[str, GetMetricsPrometheusErrorBody]`
- **Error**: `GetMetricsPrometheusErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 405, 429] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `GetMetricsPrometheusErrorBody` | `gavel_host_api/errors/get_metrics_prometheus_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.operator.get_ops_summary

- **Route**: `GET /ops/summary`
- **Auth**: `admin_key`
- **Signature**: `def get_ops_summary(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `OpsSummaryResponse`
- **Returns (raw)**: `ApiResult[OpsSummaryResponse, GetOpsSummaryErrorBody]`
- **Error**: `GetOpsSummaryErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 405, 429] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `OpsSummaryResponse` | `gavel_host_api/models/ops_summary_response.py` |
| `GetOpsSummaryErrorBody` | `gavel_host_api/errors/get_ops_summary_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.operator.list_judge_keys

- **Route**: `GET /api/judge/keys`
- **Auth**: `admin_key`
- **Signature**: `def list_judge_keys(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `ApiJudgeKeysResponse`
- **Returns (raw)**: `ApiResult[ApiJudgeKeysResponse, ListJudgeKeysErrorBody]`
- **Error**: `ListJudgeKeysErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiJudgeKeysResponse` | `gavel_host_api/models/api_judge_keys_response.py` |
| `ListJudgeKeysErrorBody` | `gavel_host_api/errors/list_judge_keys_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.operator.list_ops_rooms

- **Route**: `GET /ops/rooms`
- **Auth**: `admin_key`
- **Signature**: `def list_ops_rooms(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `OpsRoomsResponse`
- **Returns (raw)**: `ApiResult[OpsRoomsResponse, ListOpsRoomsErrorBody]`
- **Error**: `ListOpsRoomsErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 405, 429] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `OpsRoomsResponse` | `gavel_host_api/models/ops_rooms_response.py` |
| `ListOpsRoomsErrorBody` | `gavel_host_api/errors/list_ops_rooms_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.operator.ops_release_review

- **Route**: `POST /ops/auctions/{id}/release-review`
- **Auth**: `admin_key`
- **Signature**: `def ops_release_review(id_: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id`
- **Returns (parsed)**: `OpsAuctionsReleaseReviewResponse`
- **Returns (raw)**: `ApiResult[OpsAuctionsReleaseReviewResponse, OpsReleaseReviewErrorBody]`
- **Error**: `OpsReleaseReviewErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 404, 405, 409, 429] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `OpsAuctionsReleaseReviewResponse` | `gavel_host_api/models/ops_auctions_release_review_response.py` |
| `OpsReleaseReviewErrorBody` | `gavel_host_api/errors/ops_release_review_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.operator.ops_void_all

- **Route**: `POST /ops/auctions/{id}/void-all`
- **Auth**: `admin_key`
- **Signature**: `def ops_void_all(id_: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id`
- **Returns (parsed)**: `OpsAuctionsVoidAllResponse`
- **Returns (raw)**: `ApiResult[OpsAuctionsVoidAllResponse, OpsVoidAllErrorBody]`
- **Error**: `OpsVoidAllErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 404, 405, 409, 429] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `OpsAuctionsVoidAllResponse` | `gavel_host_api/models/ops_auctions_void_all_response.py` |
| `OpsVoidAllErrorBody` | `gavel_host_api/errors/ops_void_all_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.operator.pause_judge_rooms

- **Route**: `POST /api/judge/pause`
- **Auth**: `admin_key`
- **Signature**: `def pause_judge_rooms(body: ApiJudgePauseRequest | ApiJudgePauseRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `body`
- **Params**: `body` — JSON body
- **Returns (parsed)**: `ApiJudgePauseResponse`
- **Returns (raw)**: `ApiResult[ApiJudgePauseResponse, PauseJudgeRoomsErrorBody]`
- **Error**: `PauseJudgeRoomsErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 413, 415, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiJudgePauseRequest` | `gavel_host_api/models/api_judge_pause_request.py` |
| `ApiJudgePauseRequestDict` | `gavel_host_api/models/api_judge_pause_request.py` |
| `ApiJudgePauseResponse` | `gavel_host_api/models/api_judge_pause_response.py` |
| `PauseJudgeRoomsErrorBody` | `gavel_host_api/errors/pause_judge_rooms_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.operator.revoke_judge_key

- **Route**: `POST /api/judge/keys/{keyId}/revoke`
- **Auth**: `admin_key`
- **Signature**: `def revoke_judge_key(key_id: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `key_id`
- **Params**: `key_id` — path `keyId`
- **Returns (parsed)**: `ApiJudgeKeysRevokeResponse`
- **Returns (raw)**: `ApiResult[ApiJudgeKeysRevokeResponse, RevokeJudgeKeyErrorBody]`
- **Error**: `RevokeJudgeKeyErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 404, 429, 500, 503] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiJudgeKeysRevokeResponse` | `gavel_host_api/models/api_judge_keys_revoke_response.py` |
| `RevokeJudgeKeyErrorBody` | `gavel_host_api/errors/revoke_judge_key_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

