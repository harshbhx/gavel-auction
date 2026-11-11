using System;
using System.Diagnostics.CodeAnalysis;
using System.Threading.Tasks;
using GavelHostApi.Core.ErrorResponse;
using GavelHostApi.Core.Models;
using GavelHostApi.Models.AnyOf;

namespace GavelHostApi.Errors;

public sealed class ExportEventsError : ApiError
{
    private readonly Optional<Error5> _error5Value;

    private ExportEventsError(Optional<Error5> error5Value, Optional<RawError> fallback) : base(fallback)
    {
        _error5Value = error5Value;
    }

    private static ExportEventsError AsError5(Error5 value) => new(Optional<Error5>.Some(value), default);

    private static ExportEventsError AsFallback(RawError value) => new(default, Optional<RawError>.Some(value));

    public bool TryGetError5([NotNullWhen(true)] out Error5? value) => _error5Value.TryGetValue(out value);

    public TResult Match<TResult>(Func<Error5, TResult> onError5, Func<RawError, TResult> otherwise) =>
        this switch
        {
            _ when TryGetError5(out var error5Value) => onError5(error5Value),
            _ when TryGetRawError(out var fallback) => otherwise(fallback),
            _ => throw new InvalidOperationException($"{nameof(ExportEventsError)} holds no value.")
        };

    public void Match(Action<Error5> onError5, Action<RawError> otherwise)
    {
        if (TryGetError5(out var error5Value)) onError5(error5Value);
        else if (TryGetRawError(out var fallback)) otherwise(fallback);
        else throw new InvalidOperationException($"{nameof(ExportEventsError)} holds no value.");
    }

    private static Task<ExportEventsError> Create(FailedResponse response) =>
        response.StatusCode switch
        {
            401 or 404 or 405 or 429 or 500 => response.Json<Error5>().As(AsError5),
            _ => response.RawBody().As(AsFallback)
        };

    internal static ApiErrorResponse<ExportEventsError> Response { get; } = new(Create);
}
