<!-- Generated file — do not edit; regenerated with the SDK. -->

# Auctions — operations

Accessor: `client.Auctions` · Source: `src/GavelHostApi/Api/Auctions.cs` · 5 operations

**Type sources**: the file declaring each type an operation names (`RawError` excluded — see sdk-map.md).

### CreateAuction

- **Auth**: `options.AdminKey`
- **Signature**: `CreateAuction(CreateAuctionOperationRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Body`
- **Returns**: `CreateAuctionResponse`
- **Error**: `ApiException<CreateAuctionError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 403, 409, 413, 415, 429, 500, 503] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `CreateAuctionOperationRequest` | `src/GavelHostApi/Requests/Auctions/CreateAuctionOperationRequest.cs` |
| `CreateAuctionRequest` | `src/GavelHostApi/Models/CreateAuctionRequest.cs` |
| `CreateAuctionResponse` | `src/GavelHostApi/Models/CreateAuctionResponse.cs` |
| `CreateAuctionError` | `src/GavelHostApi/Errors/CreateAuctionError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### GetAuction

- **Signature**: `GetAuction(GetAuctionRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Returns**: `AuctionPublic`
- **Error**: `ApiException<GetAuctionError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [404, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `GetAuctionRequest` | `src/GavelHostApi/Requests/Auctions/GetAuctionRequest.cs` |
| `AuctionPublic` | `src/GavelHostApi/Models/AuctionPublic.cs` |
| `GetAuctionError` | `src/GavelHostApi/Errors/GetAuctionError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### RevokeAllAuctioneerTokens

- **Auth**: `options.AdminKey`
- **Signature**: `RevokeAllAuctioneerTokens(RevokeAllAuctioneerTokensRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Returns**: `Revoked`
- **Error**: `ApiException<RevokeAllAuctioneerTokensError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 403, 404, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `RevokeAllAuctioneerTokensRequest` | `src/GavelHostApi/Requests/Auctions/RevokeAllAuctioneerTokensRequest.cs` |
| `Revoked` | `src/GavelHostApi/Models/Revoked.cs` |
| `RevokeAllAuctioneerTokensError` | `src/GavelHostApi/Errors/RevokeAllAuctioneerTokensError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### RevokeAuctioneerToken

- **Auth**: `options.AdminKey`
- **Signature**: `RevokeAuctioneerToken(RevokeAuctioneerTokenRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`, `Body`
- **Returns**: `Revoked`
- **Error**: `ApiException<RevokeAuctioneerTokenError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 403, 404, 413, 415, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `RevokeAuctioneerTokenRequest` | `src/GavelHostApi/Requests/Auctions/RevokeAuctioneerTokenRequest.cs` |
| `ApiAuctionsAuctioneerRevokeRequest` | `src/GavelHostApi/Models/ApiAuctionsAuctioneerRevokeRequest.cs` |
| `Revoked` | `src/GavelHostApi/Models/Revoked.cs` |
| `RevokeAuctioneerTokenError` | `src/GavelHostApi/Errors/RevokeAuctioneerTokenError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### RotateAuctioneerToken

- **Auth**: `options.AdminKey`
- **Signature**: `RotateAuctioneerToken(RotateAuctioneerTokenRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Returns**: `ApiAuctionsAuctioneerRotateResponse`
- **Error**: `ApiException<RotateAuctioneerTokenError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 403, 404, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `RotateAuctioneerTokenRequest` | `src/GavelHostApi/Requests/Auctions/RotateAuctioneerTokenRequest.cs` |
| `ApiAuctionsAuctioneerRotateResponse` | `src/GavelHostApi/Models/ApiAuctionsAuctioneerRotateResponse.cs` |
| `RotateAuctioneerTokenError` | `src/GavelHostApi/Errors/RotateAuctioneerTokenError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

