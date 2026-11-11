using System;
using System.Diagnostics.CodeAnalysis;
using System.Threading.Tasks;
using GavelHostApi.Core.ErrorResponse;
using GavelHostApi.Core.Models;
using GavelHostApi.Models;
using GavelHostApi.Models.AnyOf;

namespace GavelHostApi.Errors;

public sealed class WarmupError : ApiError
{
    private readonly Optional<Error5> _error5Value;

    private readonly Optional<WarmupReport> _warmupReportValue;

    private WarmupError(Optional<Error5> error5Value,
        Optional<WarmupReport> warmupReportValue,
        Optional<RawError> fallback) : base(fallback)
    {
        _error5Value = error5Value;
        _warmupReportValue = warmupReportValue;
    }

    private static WarmupError AsError5(Error5 value) => new(Optional<Error5>.Some(value), default, default);

    private static WarmupError AsWarmupReport(WarmupReport value) =>
        new(default, Optional<WarmupReport>.Some(value), default);

    private static WarmupError AsFallback(RawError value) => new(default, default, Optional<RawError>.Some(value));

    public bool TryGetError5([NotNullWhen(true)] out Error5? value) => _error5Value.TryGetValue(out value);

    public bool TryGetWarmupReport([NotNullWhen(true)] out WarmupReport? value) =>
        _warmupReportValue.TryGetValue(out value);

    public TResult Match<TResult>(Func<Error5, TResult> onError5,
        Func<WarmupReport, TResult> onWarmupReport,
        Func<RawError, TResult> otherwise) =>
        this switch
        {
            _ when TryGetError5(out var error5Value) => onError5(error5Value),
            _ when TryGetWarmupReport(out var warmupReportValue) => onWarmupReport(warmupReportValue),
            _ when TryGetRawError(out var fallback) => otherwise(fallback),
            _ => throw new InvalidOperationException($"{nameof(WarmupError)} holds no value.")
        };

    public void Match(Action<Error5> onError5, Action<WarmupReport> onWarmupReport, Action<RawError> otherwise)
    {
        if (TryGetError5(out var error5Value)) onError5(error5Value);
        else if (TryGetWarmupReport(out var warmupReportValue)) onWarmupReport(warmupReportValue);
        else if (TryGetRawError(out var fallback)) otherwise(fallback);
        else throw new InvalidOperationException($"{nameof(WarmupError)} holds no value.");
    }

    private static Task<WarmupError> Create(FailedResponse response) =>
        response.StatusCode switch
        {
            429 => response.Json<Error5>().As(AsError5),
            503 => response.Json<WarmupReport>().As(AsWarmupReport),
            _ => response.RawBody().As(AsFallback)
        };

    internal static ApiErrorResponse<WarmupError> Response { get; } = new(Create);
}
