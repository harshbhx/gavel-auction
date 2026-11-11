<!-- Generated file — do not edit; regenerated with the SDK. -->

# Export — operations

Accessor: `client.Export` · Source: `src/GavelHostApi/Api/Export.cs` · 4 operations

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

### ExportEvents

- **Auth**: `options.AuctioneerAuth` OR `options.AdminKey`
- **Signature**: `ExportEvents(ExportEventsRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Returns**: `void` (Task)
- **Error**: `ApiException<ExportEventsError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 404, 405, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `ExportEventsRequest` | `src/GavelHostApi/Requests/Export/ExportEventsRequest.cs` |
| `ExportEventsError` | `src/GavelHostApi/Errors/ExportEventsError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### GetJudgeRoomLedger

- **Auth**: `options.ReviewerAuth` OR `options.AuctioneerAuth`
- **Signature**: `GetJudgeRoomLedger(GetJudgeRoomLedgerRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Returns**: `ReplayBundle`
- **Error**: `ApiException<GetJudgeRoomLedgerError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 404, 409, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `GetJudgeRoomLedgerRequest` | `src/GavelHostApi/Requests/JudgeRooms/GetJudgeRoomLedgerRequest.cs` |
| `ReplayBundle` | `src/GavelHostApi/Models/ReplayBundle.cs` |
| `GetJudgeRoomLedgerError` | `src/GavelHostApi/Errors/GetJudgeRoomLedgerError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

