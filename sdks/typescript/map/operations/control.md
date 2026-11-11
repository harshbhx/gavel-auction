<!-- Generated file — do not edit; regenerated with the SDK. -->

# Control — operations

Accessor: `client.control` · Source: `src/resources/control.ts` · 2 operations · Request and error types: namespace `Control`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `gavel-sdk`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### controlAuction

- **Signature**: `controlAuction(request: Control.ControlAuctionRequest, options?: RequestOptions): ApiPromise<ControlResponse, Control.ControlAuctionError>`
- **Wire**: `POST /api/auctions/{id}/control`
- **Auth**: `auctioneerAuth`
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ControlResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Control.ControlAuctionError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [403] `Error5` · `"error54"` [404] `Error5` · `"error55"` [409] `Error5` · `"error56"` [413] `Error5` · `"error57"` [415] `Error5` · `"error58"` [429] `Error5` · `"error59"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Control.ControlAuctionRequest` (2):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |
| `body` | `body` | `ControlRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ControlRequest` | `controlRequestSchema` | `src/models/control-request.ts` |
| `ControlResponse` | `controlResponseSchema` | `src/models/control-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### killAuction

- **Signature**: `killAuction(request: Control.KillAuctionRequest, options?: RequestOptions): ApiPromise<ApiAuctionsKillResponse, Control.KillAuctionError>`
- **Wire**: `POST /api/auctions/{id}/kill`
- **Auth**: `auctioneerAuth`
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiAuctionsKillResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Control.KillAuctionError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [403] `Error5` · `"error54"` [404] `Error5` · `"error55"` [413] `Error5` · `"error56"` [415] `Error5` · `"error57"` [429] `Error5` · `"error58"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Control.KillAuctionRequest` (2):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |
| `body` | `body` | `ApiAuctionsKillRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiAuctionsKillRequest` | `apiAuctionsKillRequestSchema` | `src/models/api-auctions-kill-request.ts` |
| `ApiAuctionsKillResponse` | `apiAuctionsKillResponseSchema` | `src/models/api-auctions-kill-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

