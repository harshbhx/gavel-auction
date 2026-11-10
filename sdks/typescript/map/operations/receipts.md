<!-- Generated file — do not edit; regenerated with the SDK. -->

# Receipts — operations

Accessor: `client.receipts` · Source: `src/resources/receipts.ts` · 2 operations · Request and error types: namespace `Receipts`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `gavel-sdk`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### createReceiptLink

- **Signature**: `createReceiptLink(request: Receipts.CreateReceiptLinkRequest, options?: RequestOptions): ApiPromise<ApiAuctionsReceiptLinkResponse, Receipts.CreateReceiptLinkError>`
- **Wire**: `POST /api/auctions/{id}/receipt-link`
- **Auth**: `sessionAuth`
- **Request body**: none — no `Content-Type` header is sent
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiAuctionsReceiptLinkResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Receipts.CreateReceiptLinkError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [403] `Error5` · `"error53"` [404] `Error5` · `"error54"` [429] `Error5` · `"error55"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Receipts.CreateReceiptLinkRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiAuctionsReceiptLinkResponse` | `apiAuctionsReceiptLinkResponseSchema` | `src/models/api-auctions-receipt-link-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

### getReceipt

- **Signature**: `getReceipt(request: Receipts.GetReceiptRequest, options?: RequestOptions): ApiPromise<ApiAuctionsReceiptResponse, Receipts.GetReceiptError>`
- **Wire**: `GET /api/auctions/{id}/receipt`
- **Auth**: `receiptAuth`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ApiAuctionsReceiptResponse`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Receipts.GetReceiptError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error5"` [401] `Error5` · `"error52"` [404] `Error5` · `"error53"` [429] `Error5` · `"error54"` [500] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Receipts.GetReceiptRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiAuctionsReceiptResponse` | `apiAuctionsReceiptResponseSchema` | `src/models/api-auctions-receipt-response.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

