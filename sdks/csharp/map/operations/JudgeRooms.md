<!-- Generated file — do not edit; regenerated with the SDK. -->

# JudgeRooms — operations

Accessor: `client.JudgeRooms` · Source: `src/GavelHostApi/Api/JudgeRooms.cs` · 11 operations

**Type sources**: the file declaring each type an operation names (`RawError` excluded — see sdk-map.md).

### CheckJudgeKey

- **Auth**: `options.JudgeKey`
- **Signature**: `CheckJudgeKey(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Returns**: `ApiJudgeKeyResponse`
- **Error**: `ApiException<CheckJudgeKeyError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 403, 404, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `ApiJudgeKeyResponse` | `src/GavelHostApi/Models/ApiJudgeKeyResponse.cs` |
| `CheckJudgeKeyError` | `src/GavelHostApi/Errors/CheckJudgeKeyError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### CloseJudgeRoom

- **Auth**: `options.AuctioneerAuth`
- **Signature**: `CloseJudgeRoom(CloseJudgeRoomRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Returns**: `ApiJudgeRoomsCloseResponse`
- **Error**: `ApiException<CloseJudgeRoomError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 403, 404, 503] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `CloseJudgeRoomRequest` | `src/GavelHostApi/Requests/JudgeRooms/CloseJudgeRoomRequest.cs` |
| `ApiJudgeRoomsCloseResponse` | `src/GavelHostApi/Models/ApiJudgeRoomsCloseResponse.cs` |
| `CloseJudgeRoomError` | `src/GavelHostApi/Errors/CloseJudgeRoomError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### CreateJudgeRoom

- **Auth**: `options.JudgeKey` OR anonymous
- **Signature**: `CreateJudgeRoom(CreateJudgeRoomRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Returns**: `JudgeRoom`
- **Error**: `ApiException<CreateJudgeRoomError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 403, 404, 413, 415, 429, 500, 503] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `CreateJudgeRoomRequest` | `src/GavelHostApi/Requests/JudgeRooms/CreateJudgeRoomRequest.cs` |
| `ApiJudgeRoomsRequest` | `src/GavelHostApi/Models/ApiJudgeRoomsRequest.cs` |
| `JudgeRoom` | `src/GavelHostApi/Models/JudgeRoom.cs` |
| `CreateJudgeRoomError` | `src/GavelHostApi/Errors/CreateJudgeRoomError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### CreateSimulatedHold

- **Auth**: `options.SessionAuth`
- **Signature**: `CreateSimulatedHold(CreateSimulatedHoldRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`, `Body`
- **Returns**: `ApiJudgeRoomsSimHoldResponse`
- **Error**: `ApiException<CreateSimulatedHoldError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 403, 404, 409, 410, 413, 415, 422, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `CreateSimulatedHoldRequest` | `src/GavelHostApi/Requests/JudgeRooms/CreateSimulatedHoldRequest.cs` |
| `ApiJudgeRoomsSimHoldRequest` | `src/GavelHostApi/Models/ApiJudgeRoomsSimHoldRequest.cs` |
| `ApiJudgeRoomsSimHoldResponse` | `src/GavelHostApi/Models/ApiJudgeRoomsSimHoldResponse.cs` |
| `CreateSimulatedHoldError` | `src/GavelHostApi/Errors/CreateSimulatedHoldError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### GetJudgeCapabilities

- **Signature**: `GetJudgeCapabilities(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Returns**: `ApiJudgeCapabilitiesResponse`
- **Error**: `ApiException<GetJudgeCapabilitiesError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `ApiJudgeCapabilitiesResponse` | `src/GavelHostApi/Models/ApiJudgeCapabilitiesResponse.cs` |
| `GetJudgeCapabilitiesError` | `src/GavelHostApi/Errors/GetJudgeCapabilitiesError.cs` |
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

### JoinJudgeRoom

- **Signature**: `JoinJudgeRoom(JoinJudgeRoomRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Body`
- **Returns**: `ApiJudgeJoinResponse`
- **Error**: `ApiException<JoinJudgeRoomError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 403, 404, 410, 413, 415, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `JoinJudgeRoomRequest` | `src/GavelHostApi/Requests/JudgeRooms/JoinJudgeRoomRequest.cs` |
| `ApiJudgeJoinRequest` | `src/GavelHostApi/Models/ApiJudgeJoinRequest.cs` |
| `ApiJudgeJoinResponse` | `src/GavelHostApi/Models/ApiJudgeJoinResponse.cs` |
| `JoinJudgeRoomError` | `src/GavelHostApi/Errors/JoinJudgeRoomError.cs` |
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

### PlaceJudgeBid

- **Auth**: `options.SessionAuth`
- **Signature**: `PlaceJudgeBid(PlaceJudgeBidRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`, `Body`
- **Returns**: `ApiJudgeRoomsBidsResponse`
- **Error**: `ApiException<PlaceJudgeBidError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [400, 401, 403, 404, 410, 413, 415, 429, 500, 503] · `TryGetApiJudgeRoomsBidsResponse21([NotNullWhen(true)] out ApiJudgeRoomsBidsResponse21? value)` [409] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `PlaceJudgeBidRequest` | `src/GavelHostApi/Requests/JudgeRooms/PlaceJudgeBidRequest.cs` |
| `ApiJudgeRoomsBidsRequest` | `src/GavelHostApi/Models/ApiJudgeRoomsBidsRequest.cs` |
| `ApiJudgeRoomsBidsResponse` | `src/GavelHostApi/Models/ApiJudgeRoomsBidsResponse.cs` |
| `PlaceJudgeBidError` | `src/GavelHostApi/Errors/PlaceJudgeBidError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |
| `ApiJudgeRoomsBidsResponse21` | `src/GavelHostApi/Models/AnyOf/ApiJudgeRoomsBidsResponse21.cs` |

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

