<!-- Generated file — do not edit; regenerated with the SDK. -->

# Receipts — operations

Accessor: `client.receipts` · Source: `gavel_host_api/apis/receipts.py` · 2 operations

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.receipts.create_receipt_link

- **Route**: `POST /api/auctions/{id}/receipt-link`
- **Auth**: `session_auth`
- **Signature**: `def create_receipt_link(id_: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id`
- **Returns (parsed)**: `ApiAuctionsReceiptLinkResponse`
- **Returns (raw)**: `ApiResult[ApiAuctionsReceiptLinkResponse, CreateReceiptLinkErrorBody]`
- **Error**: `CreateReceiptLinkErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 403, 404, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiAuctionsReceiptLinkResponse` | `gavel_host_api/models/api_auctions_receipt_link_response.py` |
| `CreateReceiptLinkErrorBody` | `gavel_host_api/errors/create_receipt_link_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

### client.receipts.get_receipt

- **Route**: `GET /api/auctions/{id}/receipt`
- **Auth**: `receipt_auth`
- **Signature**: `def get_receipt(id_: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `id_`
- **Params**: `id_` — path `id`
- **Returns (parsed)**: `ApiAuctionsReceiptResponse`
- **Returns (raw)**: `ApiResult[ApiAuctionsReceiptResponse, GetReceiptErrorBody]`
- **Error**: `GetReceiptErrorBody` — **Case A (typed)**
- **Error arms**: `Error5` [401, 404, 429, 500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ApiAuctionsReceiptResponse` | `gavel_host_api/models/api_auctions_receipt_response.py` |
| `GetReceiptErrorBody` | `gavel_host_api/errors/get_receipt_error.py` |
| `Error5` | `gavel_host_api/models/unions/error5.py` |

