<!-- Generated file — do not edit; regenerated with the SDK. -->

# Read — operations

Accessor: `client.Read` · Source: `src/GavelHostApi/Api/Read.cs` · 2 operations

**Type sources**: the file declaring each type an operation names (`RawError` excluded — see sdk-map.md).

### GetSnapshot

- **Auth**: `options.AuctioneerAuth` OR `options.ScreenAuth` OR `options.SessionAuth` OR `options.ReviewerAuth`
- **Signature**: `GetSnapshot(GetSnapshotRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Returns**: `StateFrame`
- **Error**: `ApiException<GetSnapshotError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 403, 404, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `GetSnapshotRequest` | `src/GavelHostApi/Requests/Read/GetSnapshotRequest.cs` |
| `StateFrame` | `src/GavelHostApi/Models/StateFrame.cs` |
| `GetSnapshotError` | `src/GavelHostApi/Errors/GetSnapshotError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### ListEvents

- **Auth**: `options.AuctioneerAuth` OR `options.ScreenAuth` OR `options.ReviewerAuth`
- **Signature**: `ListEvents(ListEventsRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Query params (wire ← C#)**: `after` ← `After`, `limit` ← `Limit`
- **Returns**: `ApiAuctionsEventsResponse`
- **Error**: `ApiException<ListEventsError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 404, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `ListEventsRequest` | `src/GavelHostApi/Requests/Read/ListEventsRequest.cs` |
| `ApiAuctionsEventsResponse` | `src/GavelHostApi/Models/ApiAuctionsEventsResponse.cs` |
| `ListEventsError` | `src/GavelHostApi/Errors/ListEventsError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

