<!-- Generated file — do not edit; regenerated with the SDK. -->

# Health — operations

Accessor: `client.health` · Source: `src/resources/health.ts` · 4 operations · Request and error types: namespace `Health`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `gavel-sdk`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### getHealth

- **Signature**: `getHealth(options?: RequestOptions): ApiPromise<Status, ApiError>`
- **Wire**: `GET /healthz`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `Status`
- **Error**: `GavelHostApiError` with `kind: "api"` — untyped, `payload.kind` always `"undeclared"`

| Type | Schema value | Source |
| --- | --- | --- |
| `Status` | `statusSchema` | `src/models/status.ts` |

### getReadiness

- **Signature**: `getReadiness(options?: RequestOptions): ApiPromise<Status, Health.GetReadinessError>`
- **Wire**: `GET /readyz`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `Status`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Health.GetReadinessError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"readyz503Error1"` [503] `Readyz503Error1` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `Status` | `statusSchema` | `src/models/status.ts` |
| `Readyz503Error1` | `readyz503Error1Schema` | `src/models/readyz503-error1.ts` |

### getVersion

- **Signature**: `getVersion(options?: RequestOptions): ApiPromise<VersionResponse, ApiError>`
- **Wire**: `GET /version`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `VersionResponse`
- **Error**: `GavelHostApiError` with `kind: "api"` — untyped, `payload.kind` always `"undeclared"`

| Type | Schema value | Source |
| --- | --- | --- |
| `VersionResponse` | `versionResponseSchema` | `src/models/version-response.ts` |

### warmup

- **Signature**: `warmup(options?: RequestOptions): ApiPromise<WarmupReport, Health.WarmupError>`
- **Wire**: `GET /warmup`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `WarmupReport`
- **Error**: `GavelHostApiError` with `kind: "api"`, an instance of `Health.WarmupError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"warmupReport"` [503] `WarmupReport` · `"error5"` [429] `Error5` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `WarmupReport` | `warmupReportSchema` | `src/models/warmup-report.ts` |
| `Error5` | `error5Schema` | `src/models/unions/error5.ts` |

