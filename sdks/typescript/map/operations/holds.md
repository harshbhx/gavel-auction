<!-- Generated file — do not edit; regenerated with the SDK. -->

# Holds — operations

Accessor: `client.holds` · Source: `src/resources/holds.ts` · 4 operations · Request and error types: namespace `Holds`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `gavel-sdk`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### abandonHold

- **Signature**: `abandonHold(request: Holds.AbandonHoldRequest, options?: RequestOptions): ApiPromise<ApiHoldsResponse1, Holds.AbandonHoldError>`
- **Wire**: `DELETE /api/holds/{holdId}`
- **Auth**: `sessionAuth`
- **Request body**: none — no `Content-Type` header is sent
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiHoldsResponse1`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Holds.AbandonHoldError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [404] `Error5` · `"error53"` [409] `Error5` · `"error54"` [429] `Error5` · `"error55"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Holds.AbandonHoldRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `holdId` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiHoldsResponse1` | `apiHoldsResponse1Schema` | `src/models/api-holds-response1.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### approveHold

- **Signature**: `approveHold(request: Holds.ApproveHoldRequest, options?: RequestOptions): ApiPromise<ApiHoldsApproveResponse, Holds.ApproveHoldError>`
- **Wire**: `POST /api/holds/{holdId}/approve`
- **Auth**: `sessionAuth`
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiHoldsApproveResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Holds.ApproveHoldError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [404] `Error5` · `"error54"` [409] `Error5` · `"error55"` [413] `Error5` · `"error56"` [415] `Error5` · `"error57"` [429] `Error5` · `"error58"` [500] `Error5` · `"error59"` [503] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Holds.ApproveHoldRequest` (2):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `holdId` | `path` | `string` | yes |
| `body` | `body` | `ApiHoldsApproveRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiHoldsApproveRequest` | `apiHoldsApproveRequestSchema` | `src/models/api-holds-approve-request.ts` |
| `ApiHoldsApproveResponse` | `apiHoldsApproveResponseSchema` | `src/models/api-holds-approve-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### createHold

- **Signature**: `createHold(request: Holds.CreateHoldRequest, options?: RequestOptions): ApiPromise<CreateHoldResponse, Holds.CreateHoldError>`
- **Wire**: `POST /api/holds`
- **Auth**: `sessionAuth`
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `CreateHoldResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Holds.CreateHoldError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [404] `Error5` · `"error54"` [409] `Error5` · `"error55"` [413] `Error5` · `"error56"` [415] `Error5` · `"error57"` [429] `Error5` · `"error58"` [500] `Error5` · `"error59"` [503] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Holds.CreateHoldRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `ApiHoldsRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiHoldsRequest` | `apiHoldsRequestSchema` | `src/models/api-holds-request.ts` |
| `CreateHoldResponse` | `createHoldResponseSchema` | `src/models/create-hold-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### getHold

- **Signature**: `getHold(request: Holds.GetHoldRequest, options?: RequestOptions): ApiPromise<ApiHoldsResponse, Holds.GetHoldError>`
- **Wire**: `GET /api/holds/{holdId}`
- **Auth**: `sessionAuth`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ApiHoldsResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Holds.GetHoldError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [404] `Error5` · `"error53"` [429] `Error5` · `"error54"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Holds.GetHoldRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `holdId` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiHoldsResponse` | `apiHoldsResponseSchema` | `src/models/api-holds-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

