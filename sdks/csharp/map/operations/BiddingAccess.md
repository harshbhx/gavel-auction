<!-- Generated file — do not edit; regenerated with the SDK. -->

# BiddingAccess — operations

Accessor: `client.BiddingAccess` · Source: `src/GavelHostApi/Api/BiddingAccess.cs` · 3 operations

**Type sources**: the file declaring each type an operation names (`RawError` excluded — see sdk-map.md).

### CreateInvites

- **Auth**: `options.AuctioneerAuth`
- **Signature**: `CreateInvites(CreateInvitesRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Returns**: `ApiAuctionsInvitesResponse`
- **Error**: `ApiException<CreateInvitesError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 403, 404, 413, 415, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `CreateInvitesRequest` | `src/GavelHostApi/Requests/BiddingAccess/CreateInvitesRequest.cs` |
| `ApiAuctionsInvitesRequest` | `src/GavelHostApi/Models/ApiAuctionsInvitesRequest.cs` |
| `ApiAuctionsInvitesResponse` | `src/GavelHostApi/Models/ApiAuctionsInvitesResponse.cs` |
| `CreateInvitesError` | `src/GavelHostApi/Errors/CreateInvitesError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### JoinAuction

- **Signature**: `JoinAuction(JoinAuctionRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`, `Body`
- **Returns**: `JoinResponse`
- **Error**: `ApiException<JoinAuctionError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 403, 404, 409, 413, 415, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `JoinAuctionRequest` | `src/GavelHostApi/Requests/BiddingAccess/JoinAuctionRequest.cs` |
| `ApiAuctionsJoinRequest` | `src/GavelHostApi/Models/ApiAuctionsJoinRequest.cs` |
| `JoinResponse` | `src/GavelHostApi/Models/JoinResponse.cs` |
| `JoinAuctionError` | `src/GavelHostApi/Errors/JoinAuctionError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### ReissueInvite

- **Auth**: `options.AuctioneerAuth`
- **Signature**: `ReissueInvite(ReissueInviteRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`, `BidderId`
- **Returns**: `Invite`
- **Error**: `ApiException<ReissueInviteError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 403, 404, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `ReissueInviteRequest` | `src/GavelHostApi/Requests/BiddingAccess/ReissueInviteRequest.cs` |
| `Invite` | `src/GavelHostApi/Models/Invite.cs` |
| `ReissueInviteError` | `src/GavelHostApi/Errors/ReissueInviteError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

