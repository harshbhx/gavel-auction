<!-- Generated file — do not edit; regenerated with the SDK. -->

# Holds — operations

Accessor: `client.holds` · Source: `gavel_host_api/apis/holds.py` · 4 operations

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.holds.abandon_hold

- **Route**: `DELETE /api/holds/{holdId}`
- **Auth**: `session_auth`
- **Signature**: `def abandon_hold(hold_id: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `hold_id`
- **Params**: `hold_id` — path `holdId`
- **Returns (parsed)**: `ApiHoldsResponse1`
- **Returns (raw)**: `ApiResult[ApiHoldsResponse1, AbandonHoldErrorBody]`
- **Error**: `AbandonHoldErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 404, 409, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiHoldsResponse1` | `gavel_host_api/models/api_holds_response1.py` |
| `AbandonHoldErrorBody` | `gavel_host_api/errors/abandon_hold_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.holds.approve_hold

- **Route**: `POST /api/holds/{holdId}/approve`
- **Auth**: `session_auth`
- **Signature**: `def approve_hold(hold_id: str, body: ApiHoldsApproveRequest | ApiHoldsApproveRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `hold_id`, `body`
- **Params**: `hold_id` — path `holdId` · `body` — JSON body
- **Returns (parsed)**: `ApiHoldsApproveResponse`
- **Returns (raw)**: `ApiResult[ApiHoldsApproveResponse, ApproveHoldErrorBody]`
- **Error**: `ApproveHoldErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 404, 409, 413, 415, 429, 500, 503] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiHoldsApproveRequest` | `gavel_host_api/models/api_holds_approve_request.py` |
| `ApiHoldsApproveRequestDict` | `gavel_host_api/models/api_holds_approve_request.py` |
| `ApiHoldsApproveResponse` | `gavel_host_api/models/api_holds_approve_response.py` |
| `ApproveHoldErrorBody` | `gavel_host_api/errors/approve_hold_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.holds.create_hold

- **Route**: `POST /api/holds`
- **Auth**: `session_auth`
- **Signature**: `def create_hold(body: ApiHoldsRequest | ApiHoldsRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `body`
- **Params**: `body` — JSON body
- **Returns (parsed)**: `CreateHoldResponse`
- **Returns (raw)**: `ApiResult[CreateHoldResponse, CreateHoldErrorBody]`
- **Error**: `CreateHoldErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [400, 401, 404, 409, 413, 415, 429, 500, 503] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiHoldsRequest` | `gavel_host_api/models/api_holds_request.py` |
| `ApiHoldsRequestDict` | `gavel_host_api/models/api_holds_request.py` |
| `CreateHoldResponse` | `gavel_host_api/models/create_hold_response.py` |
| `CreateHoldErrorBody` | `gavel_host_api/errors/create_hold_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.holds.get_hold

- **Route**: `GET /api/holds/{holdId}`
- **Auth**: `session_auth`
- **Signature**: `def get_hold(hold_id: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `hold_id`
- **Params**: `hold_id` — path `holdId`
- **Returns (parsed)**: `ApiHoldsResponse`
- **Returns (raw)**: `ApiResult[ApiHoldsResponse, GetHoldErrorBody]`
- **Error**: `GetHoldErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 404, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiHoldsResponse` | `gavel_host_api/models/api_holds_response.py` |
| `GetHoldErrorBody` | `gavel_host_api/errors/get_hold_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

