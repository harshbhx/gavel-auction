<!-- Generated file — do not edit; regenerated with the SDK. -->

# Receipts — operations

Accessor: `client.Receipts` · Source: `src/GavelHostApi/Api/Receipts.cs` · 2 operations

**Type sources**: the file declaring each type an operation names (`RawError` excluded — see sdk-map.md).

### CreateReceiptLink

- **Auth**: `options.SessionAuth`
- **Signature**: `CreateReceiptLink(CreateReceiptLinkRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Returns**: `ApiAuctionsReceiptLinkResponse`
- **Error**: `ApiException<CreateReceiptLinkError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 403, 404, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `CreateReceiptLinkRequest` | `src/GavelHostApi/Requests/Receipts/CreateReceiptLinkRequest.cs` |
| `ApiAuctionsReceiptLinkResponse` | `src/GavelHostApi/Models/ApiAuctionsReceiptLinkResponse.cs` |
| `CreateReceiptLinkError` | `src/GavelHostApi/Errors/CreateReceiptLinkError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

### GetReceipt

- **Auth**: `options.ReceiptAuth`
- **Signature**: `GetReceipt(GetReceiptRequest request, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
  - required: `Id`
- **Returns**: `ApiAuctionsReceiptResponse`
- **Error**: `ApiException<GetReceiptError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [401, 404, 429, 500] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `GetReceiptRequest` | `src/GavelHostApi/Requests/Receipts/GetReceiptRequest.cs` |
| `ApiAuctionsReceiptResponse` | `src/GavelHostApi/Models/ApiAuctionsReceiptResponse.cs` |
| `GetReceiptError` | `src/GavelHostApi/Errors/GetReceiptError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

