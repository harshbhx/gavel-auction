<!-- Generated file — do not edit; regenerated with the SDK. -->

# Operator — operations

Accessor: `client.operator` · Source: `src/resources/operator.ts` · 11 operations · Request and error types: namespace `Operator`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `gavel-sdk`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### adminExport

- **Signature**: `adminExport(request?: Operator.AdminExportRequest, options?: RequestOptions): ApiPromise<undefined, Operator.AdminExportError>`
- **Wire**: `GET /admin/export`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `undefined` — the operation resolves to nothing
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Operator.AdminExportError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [404] `Error5` · `"error54"` [405] `Error5` · `"error55"` [429] `Error5` · `"error56"` [500] `Error5` · `"error57"` [501] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Operator.AdminExportRequest` (3):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `auction` | `query` | `string` | no |
| `list` | `query` | `List` | no |
| `kind` | `query` | `Kind` | no |

| Type | Schema value | Source |
| --- | --- | --- |
| `List` | `listSchema` | `src/models/list.ts` |
| `Kind` | `kindSchema` | `src/models/kind.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### adminReplayBundle

- **Signature**: `adminReplayBundle(request: Operator.AdminReplayBundleRequest, options?: RequestOptions): ApiPromise<Record<string, unknown>, Operator.AdminReplayBundleError>`
- **Wire**: `GET /admin/replay-bundle`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `Record<string, unknown>` — a bare `application/json` map; the success type *is* the map
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Operator.AdminReplayBundleError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [404] `Error5` · `"error54"` [405] `Error5` · `"error55"` [409] `Error5` · `"error56"` [429] `Error5` · `"error57"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Operator.AdminReplayBundleRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `auctionId` | `query` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### getMetrics

- **Signature**: `getMetrics(options?: RequestOptions): ApiPromise<Record<string, unknown>, Operator.GetMetricsError>`
- **Wire**: `GET /metrics`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `Record<string, unknown>` — a bare `application/json` map; the success type *is* the map
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Operator.GetMetricsError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [405] `Error5` · `"error53"` [429] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### getMetricsPrometheus

- **Signature**: `getMetricsPrometheus(options?: RequestOptions): ApiPromise<string, Operator.GetMetricsPrometheusError>`
- **Wire**: `GET /metrics/prometheus`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `string` — `text/plain;charset=utf-8`, decoded by the plain-text scalar decoder, not by a model
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Operator.GetMetricsPrometheusError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [405] `Error5` · `"error53"` [429] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### getOpsSummary

- **Signature**: `getOpsSummary(options?: RequestOptions): ApiPromise<OpsSummaryResponse, Operator.GetOpsSummaryError>`
- **Wire**: `GET /ops/summary`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `OpsSummaryResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Operator.GetOpsSummaryError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [405] `Error5` · `"error53"` [429] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `OpsSummaryResponse` | `opsSummaryResponseSchema` | `src/models/ops-summary-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### listJudgeKeys

- **Signature**: `listJudgeKeys(options?: RequestOptions): ApiPromise<ApiJudgeKeysResponse, Operator.ListJudgeKeysError>`
- **Wire**: `GET /api/judge/keys`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ApiJudgeKeysResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Operator.ListJudgeKeysError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [429] `Error5` · `"error53"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiJudgeKeysResponse` | `apiJudgeKeysResponseSchema` | `src/models/api-judge-keys-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### listOpsRooms

- **Signature**: `listOpsRooms(options?: RequestOptions): ApiPromise<OpsRoomsResponse, Operator.ListOpsRoomsError>`
- **Wire**: `GET /ops/rooms`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `OpsRoomsResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Operator.ListOpsRoomsError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [405] `Error5` · `"error53"` [429] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `OpsRoomsResponse` | `opsRoomsResponseSchema` | `src/models/ops-rooms-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### opsReleaseReview

- **Signature**: `opsReleaseReview(request: Operator.OpsReleaseReviewRequest, options?: RequestOptions): ApiPromise<OpsAuctionsReleaseReviewResponse, Operator.OpsReleaseReviewError>`
- **Wire**: `POST /ops/auctions/{id}/release-review`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `OpsAuctionsReleaseReviewResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Operator.OpsReleaseReviewError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [404] `Error5` · `"error53"` [405] `Error5` · `"error54"` [409] `Error5` · `"error55"` [429] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Operator.OpsReleaseReviewRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `OpsAuctionsReleaseReviewResponse` | `opsAuctionsReleaseReviewResponseSchema` | `src/models/ops-auctions-release-review-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### opsVoidAll

- **Signature**: `opsVoidAll(request: Operator.OpsVoidAllRequest, options?: RequestOptions): ApiPromise<OpsAuctionsVoidAllResponse, Operator.OpsVoidAllError>`
- **Wire**: `POST /ops/auctions/{id}/void-all`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `OpsAuctionsVoidAllResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Operator.OpsVoidAllError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [404] `Error5` · `"error53"` [405] `Error5` · `"error54"` [409] `Error5` · `"error55"` [429] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Operator.OpsVoidAllRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `OpsAuctionsVoidAllResponse` | `opsAuctionsVoidAllResponseSchema` | `src/models/ops-auctions-void-all-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### pauseJudgeRooms

- **Signature**: `pauseJudgeRooms(request: Operator.PauseJudgeRoomsRequest, options?: RequestOptions): ApiPromise<ApiJudgePauseResponse, Operator.PauseJudgeRoomsError>`
- **Wire**: `POST /api/judge/pause`
- **Auth**: `adminKey`
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiJudgePauseResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Operator.PauseJudgeRoomsError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [413] `Error5` · `"error54"` [415] `Error5` · `"error55"` [429] `Error5` · `"error56"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Operator.PauseJudgeRoomsRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `ApiJudgePauseRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiJudgePauseRequest` | `apiJudgePauseRequestSchema` | `src/models/api-judge-pause-request.ts` |
| `ApiJudgePauseResponse` | `apiJudgePauseResponseSchema` | `src/models/api-judge-pause-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### revokeJudgeKey

- **Signature**: `revokeJudgeKey(request: Operator.RevokeJudgeKeyRequest, options?: RequestOptions): ApiPromise<ApiJudgeKeysRevokeResponse, Operator.RevokeJudgeKeyError>`
- **Wire**: `POST /api/judge/keys/{keyId}/revoke`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiJudgeKeysRevokeResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Operator.RevokeJudgeKeyError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [404] `Error5` · `"error53"` [429] `Error5` · `"error54"` [500] `Error5` · `"error55"` [503] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Operator.RevokeJudgeKeyRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `keyId` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiJudgeKeysRevokeResponse` | `apiJudgeKeysRevokeResponseSchema` | `src/models/api-judge-keys-revoke-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

