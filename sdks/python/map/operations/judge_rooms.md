<!-- Generated file — do not edit; regenerated with the SDK. -->

# JudgeRooms — operations

Accessor: `client.judge_rooms` · Source: `gavel_host_api/apis/judge_rooms.py` · 10 operations

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.judge_rooms.check_judge_key

- **Route**: `POST /api/judge/key`
- **Auth**: `judge_key`
- **Signature**: `def check_judge_key(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `ApiJudgeKeyResponse`
- **Returns (raw)**: `ApiResult[ApiJudgeKeyResponse, CheckJudgeKeyErrorBody]`
- **Error**: `CheckJudgeKeyErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 404, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiJudgeKeyResponse` | `gavel_host_api/models/api_judge_key_response.py` |
| `CheckJudgeKeyErrorBody` | `gavel_host_api/errors/check_judge_key_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.judge_rooms.create_judge_room

- **Route**: `POST /api/judge/rooms`
- **Auth**: `judge_key`
- **Signature**: `def create_judge_room(*, body: ApiJudgeRoomsRequest | ApiJudgeRoomsRequestDict | None = None, request_options: RequestOptionsOrDict | None = None)`
- **Params**: `body` — JSON body
- **Returns (parsed)**: `JudgeRoom`
- **Returns (raw)**: `ApiResult[JudgeRoom, CreateJudgeRoomErrorBody]`
- **Error**: `CreateJudgeRoomErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 404, 413, 415, 429, 500, 503] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiJudgeRoomsRequest` | `gavel_host_api/models/api_judge_rooms_request.py` |
| `ApiJudgeRoomsRequestDict` | `gavel_host_api/models/api_judge_rooms_request.py` |
| `JudgeRoom` | `gavel_host_api/models/judge_room.py` |
| `CreateJudgeRoomErrorBody` | `gavel_host_api/errors/create_judge_room_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.judge_rooms.create_simulated_hold

- **Route**: `POST /api/judge/rooms/{id}/sim-hold`
- **Auth**: `session_auth`
- **Signature**: `def create_simulated_hold(id_: str, body: ApiJudgeRoomsSimHoldRequest | ApiJudgeRoomsSimHoldRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`, `body`
- **Params**: `id_` — path `id` · `body` — JSON body
- **Returns (parsed)**: `ApiJudgeRoomsSimHoldResponse`
- **Returns (raw)**: `ApiResult[ApiJudgeRoomsSimHoldResponse, CreateSimulatedHoldErrorBody]`
- **Error**: `CreateSimulatedHoldErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 403, 404, 409, 410, 413, 415, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiJudgeRoomsSimHoldRequest` | `gavel_host_api/models/api_judge_rooms_sim_hold_request.py` |
| `ApiJudgeRoomsSimHoldRequestDict` | `gavel_host_api/models/api_judge_rooms_sim_hold_request.py` |
| `ApiJudgeRoomsSimHoldResponse` | `gavel_host_api/models/api_judge_rooms_sim_hold_response.py` |
| `CreateSimulatedHoldErrorBody` | `gavel_host_api/errors/create_simulated_hold_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.judge_rooms.get_judge_capabilities

- **Route**: `GET /api/judge/capabilities`
- **Signature**: `def get_judge_capabilities(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `ApiJudgeCapabilitiesResponse`
- **Returns (raw)**: `ApiResult[ApiJudgeCapabilitiesResponse, GetJudgeCapabilitiesErrorBody]`
- **Error**: `GetJudgeCapabilitiesErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiJudgeCapabilitiesResponse` | `gavel_host_api/models/api_judge_capabilities_response.py` |
| `GetJudgeCapabilitiesErrorBody` | `gavel_host_api/errors/get_judge_capabilities_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.judge_rooms.get_judge_room_ledger

- **Route**: `GET /api/judge/rooms/{id}/ledger`
- **Auth**: `reviewer_auth` OR `auctioneer_auth`
- **Signature**: `def get_judge_room_ledger(id_: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id`
- **Returns (parsed)**: `ReplayBundle`
- **Returns (raw)**: `ApiResult[ReplayBundle, GetJudgeRoomLedgerErrorBody]`
- **Error**: `GetJudgeRoomLedgerErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 404, 409, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ReplayBundle` | `gavel_host_api/models/replay_bundle.py` |
| `GetJudgeRoomLedgerErrorBody` | `gavel_host_api/errors/get_judge_room_ledger_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.judge_rooms.join_judge_room

- **Route**: `POST /api/judge/join`
- **Signature**: `def join_judge_room(body: ApiJudgeJoinRequest | ApiJudgeJoinRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `body`
- **Params**: `body` — JSON body
- **Returns (parsed)**: `ApiJudgeJoinResponse`
- **Returns (raw)**: `ApiResult[ApiJudgeJoinResponse, JoinJudgeRoomErrorBody]`
- **Error**: `JoinJudgeRoomErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 404, 410, 413, 415, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiJudgeJoinRequest` | `gavel_host_api/models/api_judge_join_request.py` |
| `ApiJudgeJoinRequestDict` | `gavel_host_api/models/api_judge_join_request.py` |
| `ApiJudgeJoinResponse` | `gavel_host_api/models/api_judge_join_response.py` |
| `JoinJudgeRoomErrorBody` | `gavel_host_api/errors/join_judge_room_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.judge_rooms.list_judge_keys

- **Route**: `GET /api/judge/keys`
- **Auth**: `admin_key`
- **Signature**: `def list_judge_keys(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `ApiJudgeKeysResponse`
- **Returns (raw)**: `ApiResult[ApiJudgeKeysResponse, ListJudgeKeysErrorBody]`
- **Error**: `ListJudgeKeysErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiJudgeKeysResponse` | `gavel_host_api/models/api_judge_keys_response.py` |
| `ListJudgeKeysErrorBody` | `gavel_host_api/errors/list_judge_keys_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.judge_rooms.pause_judge_rooms

- **Route**: `POST /api/judge/pause`
- **Auth**: `admin_key`
- **Signature**: `def pause_judge_rooms(body: ApiJudgePauseRequest | ApiJudgePauseRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `body`
- **Params**: `body` — JSON body
- **Returns (parsed)**: `ApiJudgePauseResponse`
- **Returns (raw)**: `ApiResult[ApiJudgePauseResponse, PauseJudgeRoomsErrorBody]`
- **Error**: `PauseJudgeRoomsErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 413, 415, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiJudgePauseRequest` | `gavel_host_api/models/api_judge_pause_request.py` |
| `ApiJudgePauseRequestDict` | `gavel_host_api/models/api_judge_pause_request.py` |
| `ApiJudgePauseResponse` | `gavel_host_api/models/api_judge_pause_response.py` |
| `PauseJudgeRoomsErrorBody` | `gavel_host_api/errors/pause_judge_rooms_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.judge_rooms.place_judge_bid

- **Route**: `POST /api/judge/rooms/{id}/bids`
- **Auth**: `session_auth`
- **Signature**: `def place_judge_bid(id_: str, body: ApiJudgeRoomsBidsRequest | ApiJudgeRoomsBidsRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`, `body`
- **Params**: `id_` — path `id` · `body` — JSON body
- **Returns (parsed)**: `ApiJudgeRoomsBidsResponse`
- **Returns (raw)**: `ApiResult[ApiJudgeRoomsBidsResponse, PlaceJudgeBidErrorBody]`
- **Error**: `PlaceJudgeBidErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 403, 404, 410, 413, 415, 429, 500, 503] · `ApiJudgeRoomsBidsResponse21` [409] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiJudgeRoomsBidsRequest` | `gavel_host_api/models/api_judge_rooms_bids_request.py` |
| `ApiJudgeRoomsBidsRequestDict` | `gavel_host_api/models/api_judge_rooms_bids_request.py` |
| `ApiJudgeRoomsBidsResponse` | `gavel_host_api/models/api_judge_rooms_bids_response.py` |
| `PlaceJudgeBidErrorBody` | `gavel_host_api/errors/place_judge_bid_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |
| `ApiJudgeRoomsBidsResponse21` | `gavel_host_api/models/unions/api_judge_rooms_bids_response21.py` |

### client.judge_rooms.revoke_judge_key

- **Route**: `POST /api/judge/keys/{keyId}/revoke`
- **Auth**: `admin_key`
- **Signature**: `def revoke_judge_key(key_id: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `key_id`
- **Params**: `key_id` — path `keyId`
- **Returns (parsed)**: `ApiJudgeKeysRevokeResponse`
- **Returns (raw)**: `ApiResult[ApiJudgeKeysRevokeResponse, RevokeJudgeKeyErrorBody]`
- **Error**: `RevokeJudgeKeyErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 404, 429, 500, 503] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiJudgeKeysRevokeResponse` | `gavel_host_api/models/api_judge_keys_revoke_response.py` |
| `RevokeJudgeKeyErrorBody` | `gavel_host_api/errors/revoke_judge_key_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

