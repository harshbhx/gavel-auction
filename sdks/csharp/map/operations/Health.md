<!-- Generated file — do not edit; regenerated with the SDK. -->

# Health — operations

Accessor: `client.Health` · Source: `src/GavelHostApi/Api/Health.cs` · 4 operations

**Type sources**: the file declaring each type an operation names (`RawError` excluded — see sdk-map.md).

### GetHealth

- **Signature**: `GetHealth(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Returns**: `Status`
- **Error**: `ApiException<RawError>` — **Case B**

| Type | Source |
| --- | --- |
| `Status` | `src/GavelHostApi/Models/Status.cs` |

### GetReadiness

- **Signature**: `GetReadiness(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Returns**: `Status`
- **Error**: `ApiException<GetReadinessError>` — **Case A (typed)**
- **Error accessors**: `TryGetReadyz503Error1([NotNullWhen(true)] out Readyz503Error1? value)` [503] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `Status` | `src/GavelHostApi/Models/Status.cs` |
| `GetReadinessError` | `src/GavelHostApi/Errors/GetReadinessError.cs` |
| `Readyz503Error1` | `src/GavelHostApi/Models/Readyz503Error1.cs` |

### GetVersion

- **Signature**: `GetVersion(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Returns**: `VersionResponse`
- **Error**: `ApiException<RawError>` — **Case B**

| Type | Source |
| --- | --- |
| `VersionResponse` | `src/GavelHostApi/Models/VersionResponse.cs` |

### Warmup

- **Signature**: `Warmup(RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)`
- **Returns**: `WarmupReport`
- **Error**: `ApiException<WarmupError>` — **Case A (typed)**
- **Error accessors**: `TryGetError5([NotNullWhen(true)] out Error5? value)` [429] · `TryGetWarmupReport([NotNullWhen(true)] out WarmupReport? value)` [503] · `TryGetRawError([NotNullWhen(true)] out RawError? error)` [fallback]

| Type | Source |
| --- | --- |
| `WarmupReport` | `src/GavelHostApi/Models/WarmupReport.cs` |
| `WarmupError` | `src/GavelHostApi/Errors/WarmupError.cs` |
| `Error5` | `src/GavelHostApi/Models/AnyOf/Error5.cs` |

