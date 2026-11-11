<!-- Generated file — do not edit; regenerated with the SDK. -->

# Control — operations

Accessor: `client.Control` · Source: `src/GavelHostApi/Api/Control.cs` · 2 operations

**Type sources**: the file declaring each type an operation names (`RawError` excluded — see sdk-map.md).

### ControlAuction

- **Auth**: `options.AuctioneerAuth`
- **Signature**: `ControlAuction(ControlAuctionRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`, `Body`
- **Returns**: `ControlResponse`
- **Error**: `ApiException<ControlAuctionError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 403, 404, 409, 413, 415, 429, 500, 503] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `ControlAuctionRequest` | `src/GavelHostApi/Requests/Control/ControlAuctionRequest.cs` |
| `ControlRequest` | `src/GavelHostApi/Models/ControlRequest.cs` |
| `ControlResponse` | `src/GavelHostApi/Models/ControlResponse.cs` |
| `ControlAuctionError` | `src/GavelHostApi/Errors/ControlAuctionError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### KillAuction

- **Auth**: `options.AuctioneerAuth`
- **Signature**: `KillAuction(KillAuctionRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`, `Body`
- **Returns**: `ApiAuctionsKillResponse`
- **Error**: `ApiException<KillAuctionError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 403, 404, 409, 413, 415, 429, 500, 503] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `KillAuctionRequest` | `src/GavelHostApi/Requests/Control/KillAuctionRequest.cs` |
| `ApiAuctionsKillRequest` | `src/GavelHostApi/Models/ApiAuctionsKillRequest.cs` |
| `ApiAuctionsKillResponse` | `src/GavelHostApi/Models/ApiAuctionsKillResponse.cs` |
| `KillAuctionError` | `src/GavelHostApi/Errors/KillAuctionError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

