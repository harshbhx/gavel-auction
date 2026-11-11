<!-- Generated file — do not edit; regenerated with the SDK. -->

# Holds — operations

Accessor: `client.Holds` · Source: `src/GavelHostApi/Api/Holds.cs` · 4 operations

**Type sources**: the file declaring each type an operation names (`RawError` excluded — see sdk-map.md).

### AbandonHold

- **Auth**: `options.SessionAuth`
- **Signature**: `AbandonHold(AbandonHoldRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `HoldId`
- **Returns**: `ApiHoldsResponse1`
- **Error**: `ApiException<AbandonHoldError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 403, 404, 409, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `AbandonHoldRequest` | `src/GavelHostApi/Requests/Holds/AbandonHoldRequest.cs` |
| `ApiHoldsResponse1` | `src/GavelHostApi/Models/ApiHoldsResponse1.cs` |
| `AbandonHoldError` | `src/GavelHostApi/Errors/AbandonHoldError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### ApproveHold

- **Auth**: `options.SessionAuth`
- **Signature**: `ApproveHold(ApproveHoldRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `HoldId`, `Body`
- **Returns**: `ApiHoldsApproveResponse`
- **Error**: `ApiException<ApproveHoldError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 403, 404, 409, 413, 415, 429, 500, 503] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `ApproveHoldRequest` | `src/GavelHostApi/Requests/Holds/ApproveHoldRequest.cs` |
| `ApiHoldsApproveRequest` | `src/GavelHostApi/Models/ApiHoldsApproveRequest.cs` |
| `ApiHoldsApproveResponse` | `src/GavelHostApi/Models/ApiHoldsApproveResponse.cs` |
| `ApproveHoldError` | `src/GavelHostApi/Errors/ApproveHoldError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### CreateHold

- **Auth**: `options.SessionAuth`
- **Signature**: `CreateHold(CreateHoldRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Body`
- **Returns**: `CreateHoldResponse`
- **Error**: `ApiException<CreateHoldError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `CreateHoldRequest` | `src/GavelHostApi/Requests/Holds/CreateHoldRequest.cs` |
| `ApiHoldsRequest` | `src/GavelHostApi/Models/ApiHoldsRequest.cs` |
| `CreateHoldResponse` | `src/GavelHostApi/Models/CreateHoldResponse.cs` |
| `CreateHoldError` | `src/GavelHostApi/Errors/CreateHoldError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### GetHold

- **Auth**: `options.SessionAuth`
- **Signature**: `GetHold(GetHoldRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `HoldId`
- **Returns**: `ApiHoldsResponse`
- **Error**: `ApiException<GetHoldError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 404, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `GetHoldRequest` | `src/GavelHostApi/Requests/Holds/GetHoldRequest.cs` |
| `ApiHoldsResponse` | `src/GavelHostApi/Models/ApiHoldsResponse.cs` |
| `GetHoldError` | `src/GavelHostApi/Errors/GetHoldError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

