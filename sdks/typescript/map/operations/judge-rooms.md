<!-- Generated file — do not edit; regenerated with the SDK. -->

# JudgeRooms — operations

Accessor: `client.judgeRooms` · Source: `src/resources/judge-rooms.ts` · 10 operations · Request and error types: namespace `JudgeRooms`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `gavel-sdk`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### checkJudgeKey

- **Signature**: `checkJudgeKey(options?: RequestOptions): ApiPromise<ApiJudgeKeyResponse, JudgeRooms.CheckJudgeKeyError>`
- **Wire**: `POST /api/judge/key`
- **Auth**: `judgeKey`
- **Request body**: none — no `Content-Type` header is sent
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiJudgeKeyResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `JudgeRooms.CheckJudgeKeyError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [404] `Error5` · `"error53"` [429] `Error5` · `"error54"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiJudgeKeyResponse` | `apiJudgeKeyResponseSchema` | `src/models/api-judge-key-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### createJudgeRoom

- **Signature**: `createJudgeRoom(request?: JudgeRooms.CreateJudgeRoomRequest, options?: RequestOptions): ApiPromise<JudgeRoom, JudgeRooms.CreateJudgeRoomError>`
- **Wire**: `POST /api/judge/rooms`
- **Auth**: `judgeKey`
- **Request body**: `application/json` — the `body` field. **Optional**: omit it and the request carries no body and no `Content-Type` header at all
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `JudgeRoom`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `JudgeRooms.CreateJudgeRoomError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [404] `Error5` · `"error54"` [413] `Error5` · `"error55"` [415] `Error5` · `"error56"` [429] `Error5` · `"error57"` [500] `Error5` · `"error58"` [503] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `JudgeRooms.CreateJudgeRoomRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `ApiJudgeRoomsRequest` | no |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiJudgeRoomsRequest` | `apiJudgeRoomsRequestSchema` | `src/models/api-judge-rooms-request.ts` |
| `JudgeRoom` | `judgeRoomSchema` | `src/models/judge-room.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### createSimulatedHold

- **Signature**: `createSimulatedHold(request: JudgeRooms.CreateSimulatedHoldRequest, options?: RequestOptions): ApiPromise<ApiJudgeRoomsSimHoldResponse, JudgeRooms.CreateSimulatedHoldError>`
- **Wire**: `POST /api/judge/rooms/{id}/sim-hold`
- **Auth**: `sessionAuth`
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiJudgeRoomsSimHoldResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `JudgeRooms.CreateSimulatedHoldError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [403] `Error5` · `"error54"` [404] `Error5` · `"error55"` [409] `Error5` · `"error56"` [410] `Error5` · `"error57"` [413] `Error5` · `"error58"` [415] `Error5` · `"error59"` [429] `Error5` · `"error510"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `JudgeRooms.CreateSimulatedHoldRequest` (2):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |
| `body` | `body` | `ApiJudgeRoomsSimHoldRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiJudgeRoomsSimHoldRequest` | `apiJudgeRoomsSimHoldRequestSchema` | `src/models/api-judge-rooms-sim-hold-request.ts` |
| `ApiJudgeRoomsSimHoldResponse` | `apiJudgeRoomsSimHoldResponseSchema` | `src/models/api-judge-rooms-sim-hold-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### getJudgeCapabilities

- **Signature**: `getJudgeCapabilities(options?: RequestOptions): ApiPromise<ApiJudgeCapabilitiesResponse, JudgeRooms.GetJudgeCapabilitiesError>`
- **Wire**: `GET /api/judge/capabilities`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ApiJudgeCapabilitiesResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `JudgeRooms.GetJudgeCapabilitiesError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [429] `Error5` · `"error52"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiJudgeCapabilitiesResponse` | `apiJudgeCapabilitiesResponseSchema` | `src/models/api-judge-capabilities-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### getJudgeRoomLedger

- **Signature**: `getJudgeRoomLedger(request: JudgeRooms.GetJudgeRoomLedgerRequest, options?: RequestOptions): ApiPromise<ReplayBundle, JudgeRooms.GetJudgeRoomLedgerError>`
- **Wire**: `GET /api/judge/rooms/{id}/ledger`
- **Auth**: any of `reviewerAuth`, `auctioneerAuth` — the first one configured is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ReplayBundle`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `JudgeRooms.GetJudgeRoomLedgerError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [404] `Error5` · `"error53"` [409] `Error5` · `"error54"` [429] `Error5` · `"error55"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `JudgeRooms.GetJudgeRoomLedgerRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ReplayBundle` | `replayBundleSchema` | `src/models/replay-bundle.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### joinJudgeRoom

- **Signature**: `joinJudgeRoom(request: JudgeRooms.JoinJudgeRoomRequest, options?: RequestOptions): ApiPromise<ApiJudgeJoinResponse, JudgeRooms.JoinJudgeRoomError>`
- **Wire**: `POST /api/judge/join`
- **Auth**: none — public; no credential is sent
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiJudgeJoinResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `JudgeRooms.JoinJudgeRoomError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [404] `Error5` · `"error53"` [410] `Error5` · `"error54"` [413] `Error5` · `"error55"` [415] `Error5` · `"error56"` [429] `Error5` · `"error57"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `JudgeRooms.JoinJudgeRoomRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `ApiJudgeJoinRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiJudgeJoinRequest` | `apiJudgeJoinRequestSchema` | `src/models/api-judge-join-request.ts` |
| `ApiJudgeJoinResponse` | `apiJudgeJoinResponseSchema` | `src/models/api-judge-join-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### listJudgeKeys

- **Signature**: `listJudgeKeys(options?: RequestOptions): ApiPromise<ApiJudgeKeysResponse, JudgeRooms.ListJudgeKeysError>`
- **Wire**: `GET /api/judge/keys`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ApiJudgeKeysResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `JudgeRooms.ListJudgeKeysError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [429] `Error5` · `"error53"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiJudgeKeysResponse` | `apiJudgeKeysResponseSchema` | `src/models/api-judge-keys-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### pauseJudgeRooms

- **Signature**: `pauseJudgeRooms(request: JudgeRooms.PauseJudgeRoomsRequest, options?: RequestOptions): ApiPromise<ApiJudgePauseResponse, JudgeRooms.PauseJudgeRoomsError>`
- **Wire**: `POST /api/judge/pause`
- **Auth**: `adminKey`
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiJudgePauseResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `JudgeRooms.PauseJudgeRoomsError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [413] `Error5` · `"error54"` [415] `Error5` · `"error55"` [429] `Error5` · `"error56"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `JudgeRooms.PauseJudgeRoomsRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `ApiJudgePauseRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiJudgePauseRequest` | `apiJudgePauseRequestSchema` | `src/models/api-judge-pause-request.ts` |
| `ApiJudgePauseResponse` | `apiJudgePauseResponseSchema` | `src/models/api-judge-pause-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### placeJudgeBid

- **Signature**: `placeJudgeBid(request: JudgeRooms.PlaceJudgeBidRequest, options?: RequestOptions): ApiPromise<ApiJudgeRoomsBidsResponse, JudgeRooms.PlaceJudgeBidError>`
- **Wire**: `POST /api/judge/rooms/{id}/bids`
- **Auth**: `sessionAuth`
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiJudgeRoomsBidsResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `JudgeRooms.PlaceJudgeBidError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [403] `Error5` · `"error54"` [404] `Error5` · `"apiJudgeRoomsBidsResponse21"` [409] `ApiJudgeRoomsBidsResponse21` · `"error55"` [410] `Error5` · `"error56"` [413] `Error5` · `"error57"` [415] `Error5` · `"error58"` [429] `Error5` · `"error59"` [500] `Error5` · `"error510"` [503] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `JudgeRooms.PlaceJudgeBidRequest` (2):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |
| `body` | `body` | `ApiJudgeRoomsBidsRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiJudgeRoomsBidsRequest` | `apiJudgeRoomsBidsRequestSchema` | `src/models/api-judge-rooms-bids-request.ts` |
| `ApiJudgeRoomsBidsResponse` | `apiJudgeRoomsBidsResponseSchema` | `src/models/api-judge-rooms-bids-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |
| `ApiJudgeRoomsBidsResponse21` | `apiJudgeRoomsBidsResponse21Schema` | `src/models/unions/api-judge-rooms-bids-response21.ts` |

### revokeJudgeKey

- **Signature**: `revokeJudgeKey(request: JudgeRooms.RevokeJudgeKeyRequest, options?: RequestOptions): ApiPromise<ApiJudgeKeysRevokeResponse, JudgeRooms.RevokeJudgeKeyError>`
- **Wire**: `POST /api/judge/keys/{keyId}/revoke`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiJudgeKeysRevokeResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `JudgeRooms.RevokeJudgeKeyError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [404] `Error5` · `"error53"` [429] `Error5` · `"error54"` [500] `Error5` · `"error55"` [503] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `JudgeRooms.RevokeJudgeKeyRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `keyId` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiJudgeKeysRevokeResponse` | `apiJudgeKeysRevokeResponseSchema` | `src/models/api-judge-keys-revoke-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

