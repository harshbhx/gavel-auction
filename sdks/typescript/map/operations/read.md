<!-- Generated file — do not edit; regenerated with the SDK. -->

# Read — operations

Accessor: `client.read` · Source: `src/resources/read.ts` · 2 operations · Request and error types: namespace `Read`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `gavel-sdk`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### getSnapshot

- **Signature**: `getSnapshot(request: Read.GetSnapshotRequest, options?: RequestOptions): ApiPromise<StateFrame, Read.GetSnapshotError>`
- **Wire**: `GET /api/auctions/{id}/snapshot`
- **Auth**: any of `auctioneerAuth`, `screenAuth`, `sessionAuth`, `reviewerAuth` — the first one configured is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `StateFrame`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Read.GetSnapshotError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [403] `Error5` · `"error53"` [404] `Error5` · `"error54"` [429] `Error5` · `"error55"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Read.GetSnapshotRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `StateFrame` | `stateFrameSchema` | `src/models/state-frame.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### listEvents

- **Signature**: `listEvents(request: Read.ListEventsRequest, options?: RequestOptions): ApiPromise<ApiAuctionsEventsResponse, Read.ListEventsError>`
- **Wire**: `GET /api/auctions/{id}/events`
- **Auth**: any of `auctioneerAuth`, `screenAuth`, `reviewerAuth` — the first one configured is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ApiAuctionsEventsResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Read.ListEventsError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [400] `Error5` · `"error52"` [401] `Error5` · `"error53"` [404] `Error5` · `"error54"` [429] `Error5` · `"error55"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Read.ListEventsRequest` (3):

| Field | Channel | Type | Req | Default |
| --- | --- | --- | --- | --- |
| `id` | `path` | `string` | yes | — |
| `after` | `query` | `number` | no | `0` |
| `limit` | `query` | `number` | no | `100` |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiAuctionsEventsResponse` | `apiAuctionsEventsResponseSchema` | `src/models/api-auctions-events-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

