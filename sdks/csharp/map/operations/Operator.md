<!-- Generated file — do not edit; regenerated with the SDK. -->

# Operator — operations

Accessor: `client.Operator` · Source: `src/GavelHostApi/Api/Operator.cs` · 11 operations

**Type sources**: the file declaring each type an operation names (`RawError` excluded — see sdk-map.md).

### AdminExport

- **Auth**: `options.AdminKey`
- **Signature**: `AdminExport(AdminExportRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Query params (wire ← C#)**: `auction` ← `Auction`, `list` ← `List`, `kind` ← `Kind`
- **Returns**: `void` (Task)
- **Error**: `ApiException<AdminExportError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 404, 405, 429, 500, 501] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `AdminExportRequest` | `src/GavelHostApi/Requests/Operator/AdminExportRequest.cs` |
| `ListEnum` | `src/GavelHostApi/Models/Enums/ListEnum.cs` |
| `Kind` | `src/GavelHostApi/Models/Enums/Kind.cs` |
| `AdminExportError` | `src/GavelHostApi/Errors/AdminExportError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### AdminReplayBundle

- **Auth**: `options.AdminKey`
- **Signature**: `AdminReplayBundle(AdminReplayBundleRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `AuctionId`
- **Query params (wire ← C#)**: `auctionId` ← `AuctionId`
- **Returns**: `ReplayBundle`
- **Error**: `ApiException<AdminReplayBundleError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 404, 405, 409, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `AdminReplayBundleRequest` | `src/GavelHostApi/Requests/Operator/AdminReplayBundleRequest.cs` |
| `ReplayBundle` | `src/GavelHostApi/Models/ReplayBundle.cs` |
| `AdminReplayBundleError` | `src/GavelHostApi/Errors/AdminReplayBundleError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### GetMetrics

- **Auth**: `options.AdminKey`
- **Signature**: `GetMetrics(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Returns**: `object`
- **Error**: `ApiException<GetMetricsError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 405, 429] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `GetMetricsError` | `src/GavelHostApi/Errors/GetMetricsError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### GetMetricsPrometheus

- **Auth**: `options.AdminKey`
- **Signature**: `GetMetricsPrometheus(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Returns**: `string`
- **Error**: `ApiException<GetMetricsPrometheusError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 405, 429] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `GetMetricsPrometheusError` | `src/GavelHostApi/Errors/GetMetricsPrometheusError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### GetOpsSummary

- **Auth**: `options.AdminKey`
- **Signature**: `GetOpsSummary(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Returns**: `OpsSummaryResponse`
- **Error**: `ApiException<GetOpsSummaryError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 405, 429] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `OpsSummaryResponse` | `src/GavelHostApi/Models/OpsSummaryResponse.cs` |
| `GetOpsSummaryError` | `src/GavelHostApi/Errors/GetOpsSummaryError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### ListJudgeKeys

- **Auth**: `options.AdminKey`
- **Signature**: `ListJudgeKeys(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Returns**: `ApiJudgeKeysResponse`
- **Error**: `ApiException<ListJudgeKeysError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `ApiJudgeKeysResponse` | `src/GavelHostApi/Models/ApiJudgeKeysResponse.cs` |
| `ListJudgeKeysError` | `src/GavelHostApi/Errors/ListJudgeKeysError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### ListOpsRooms

- **Auth**: `options.AdminKey`
- **Signature**: `ListOpsRooms(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Returns**: `OpsRoomsResponse`
- **Error**: `ApiException<ListOpsRoomsError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 405, 429] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `OpsRoomsResponse` | `src/GavelHostApi/Models/OpsRoomsResponse.cs` |
| `ListOpsRoomsError` | `src/GavelHostApi/Errors/ListOpsRoomsError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### OpsReleaseReview

- **Auth**: `options.AdminKey`
- **Signature**: `OpsReleaseReview(OpsReleaseReviewRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Returns**: `OpsAuctionsReleaseReviewResponse`
- **Error**: `ApiException<OpsReleaseReviewError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 404, 405, 409, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `OpsReleaseReviewRequest` | `src/GavelHostApi/Requests/Operator/OpsReleaseReviewRequest.cs` |
| `OpsAuctionsReleaseReviewResponse` | `src/GavelHostApi/Models/OpsAuctionsReleaseReviewResponse.cs` |
| `OpsReleaseReviewError` | `src/GavelHostApi/Errors/OpsReleaseReviewError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### OpsVoidAll

- **Auth**: `options.AdminKey`
- **Signature**: `OpsVoidAll(OpsVoidAllRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Returns**: `OpsAuctionsVoidAllResponse`
- **Error**: `ApiException<OpsVoidAllError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 404, 405, 409, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `OpsVoidAllRequest` | `src/GavelHostApi/Requests/Operator/OpsVoidAllRequest.cs` |
| `OpsAuctionsVoidAllResponse` | `src/GavelHostApi/Models/OpsAuctionsVoidAllResponse.cs` |
| `OpsVoidAllError` | `src/GavelHostApi/Errors/OpsVoidAllError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### PauseJudgeRooms

- **Auth**: `options.AdminKey`
- **Signature**: `PauseJudgeRooms(PauseJudgeRoomsRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Body`
- **Returns**: `ApiJudgePauseResponse`
- **Error**: `ApiException<PauseJudgeRoomsError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 403, 409, 413, 415, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `PauseJudgeRoomsRequest` | `src/GavelHostApi/Requests/JudgeRooms/PauseJudgeRoomsRequest.cs` |
| `ApiJudgePauseRequest` | `src/GavelHostApi/Models/ApiJudgePauseRequest.cs` |
| `ApiJudgePauseResponse` | `src/GavelHostApi/Models/ApiJudgePauseResponse.cs` |
| `PauseJudgeRoomsError` | `src/GavelHostApi/Errors/PauseJudgeRoomsError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### RevokeJudgeKey

- **Auth**: `options.AdminKey`
- **Signature**: `RevokeJudgeKey(RevokeJudgeKeyRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `KeyId`
- **Returns**: `ApiJudgeKeysRevokeResponse`
- **Error**: `ApiException<RevokeJudgeKeyError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 403, 404, 429, 500, 503] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `RevokeJudgeKeyRequest` | `src/GavelHostApi/Requests/JudgeRooms/RevokeJudgeKeyRequest.cs` |
| `ApiJudgeKeysRevokeResponse` | `src/GavelHostApi/Models/ApiJudgeKeysRevokeResponse.cs` |
| `RevokeJudgeKeyError` | `src/GavelHostApi/Errors/RevokeJudgeKeyError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

