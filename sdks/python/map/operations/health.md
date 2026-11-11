<!-- Generated file — do not edit; regenerated with the SDK. -->

# Health — operations

Accessor: `client.health` · Source: `gavel_host_api/apis/health.py` · 4 operations

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.health.get_health

- **Route**: `GET /healthz`
- **Signature**: `def get_health(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `Status`
- **Returns (raw)**: `ApiResult[Status, RawError]`
- **Error**: `RawError` — **Case B**

| Type | Source |
| --- | --- |
| `Status` | `gavel_host_api/models/status.py` |

### client.health.get_readiness

- **Route**: `GET /readyz`
- **Signature**: `def get_readiness(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `Status`
- **Returns (raw)**: `ApiResult[Status, GetReadinessErrorBody]`
- **Error**: `GetReadinessErrorBody` — **Case A (typed)**
- **Error arms**: `Readyz503Error1` [503] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `Status` | `gavel_host_api/models/status.py` |
| `GetReadinessErrorBody` | `gavel_host_api/errors/get_readiness_error.py` |
| `Readyz503Error1` | `gavel_host_api/models/readyz503_error1.py` |

### client.health.get_version

- **Route**: `GET /version`
- **Signature**: `def get_version(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `VersionResponse`
- **Returns (raw)**: `ApiResult[VersionResponse, RawError]`
- **Error**: `RawError` — **Case B**

| Type | Source |
| --- | --- |
| `VersionResponse` | `gavel_host_api/models/version_response.py` |

### client.health.warmup

- **Route**: `GET /warmup`
- **Signature**: `def warmup(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `WarmupReport`
- **Returns (raw)**: `ApiResult[WarmupReport, WarmupErrorBody]`
- **Error**: `WarmupErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [429] · `WarmupReport` [503] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `WarmupReport` | `gavel_host_api/models/warmup_report.py` |
| `WarmupErrorBody` | `gavel_host_api/errors/warmup_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

