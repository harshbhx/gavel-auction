<!-- Generated file — do not edit; regenerated with the SDK. -->

# Export — operations

Accessor: `client.export` · Source: `src/resources/export.ts` · 4 operations · Request and error types: namespace `Export`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `gavel-sdk`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### adminExport

- **Signature**: `adminExport(request?: Export.AdminExportRequest, options?: RequestOptions): ApiPromise<undefined, Export.AdminExportError>`
- **Wire**: `GET /admin/export`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `undefined` — the operation resolves to nothing
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Export.AdminExportError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [404] `Error5` · `"error54"` [405] `Error5` · `"error55"` [429] `Error5` · `"error56"` [500] `Error5` · `"error57"` [501] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Export.AdminExportRequest` (3):

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

- **Signature**: `adminReplayBundle(request: Export.AdminReplayBundleRequest, options?: RequestOptions): ApiPromise<Record<string, unknown>, Export.AdminReplayBundleError>`
- **Wire**: `GET /admin/replay-bundle`
- **Auth**: `adminKey`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `Record<string, unknown>` — a bare `application/json` map; the success type *is* the map
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Export.AdminReplayBundleError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [404] `Error5` · `"error54"` [405] `Error5` · `"error55"` [409] `Error5` · `"error56"` [429] `Error5` · `"error57"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Export.AdminReplayBundleRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `auctionId` | `query` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### exportEvents

- **Signature**: `exportEvents(request: Export.ExportEventsRequest, options?: RequestOptions): ApiPromise<undefined, Export.ExportEventsError>`
- **Wire**: `GET /api/auctions/{id}/export`
- **Auth**: any of `auctioneerAuth`, `adminKey` — the first one configured is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `undefined` — the operation resolves to nothing
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Export.ExportEventsError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [403] `Error5` · `"error53"` [404] `Error5` · `"error54"` [405] `Error5` · `"error55"` [429] `Error5` · `"error56"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Export.ExportEventsRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### getJudgeRoomLedger

- **Signature**: `getJudgeRoomLedger(request: Export.GetJudgeRoomLedgerRequest, options?: RequestOptions): ApiPromise<ReplayBundle, Export.GetJudgeRoomLedgerError>`
- **Wire**: `GET /api/judge/rooms/{id}/ledger`
- **Auth**: any of `reviewerAuth`, `auctioneerAuth` — the first one configured is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ReplayBundle`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Export.GetJudgeRoomLedgerError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [404] `Error5` · `"error53"` [409] `Error5` · `"error54"` [429] `Error5` · `"error55"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Export.GetJudgeRoomLedgerRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ReplayBundle` | `replayBundleSchema` | `src/models/replay-bundle.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

