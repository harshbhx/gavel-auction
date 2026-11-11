using System;
using System.Diagnostics.CodeAnalysis;
using System.Threading.Tasks;
using GavelHostApi.Core.ErrorResponse;
using GavelHostApi.Core.Models;
using GavelHostApi.Models;

namespace GavelHostApi.Errors;

public sealed class GetReadinessError : ApiError
{
    private readonly Optional<Readyz503Error1> _readyz503Error1Value;

    private GetReadinessError(Optional<Readyz503Error1> readyz503Error1Value,
        Optional<RawError> fallback) : base(fallback)
    {
        _readyz503Error1Value = readyz503Error1Value;
    }

    private static GetReadinessError AsReadyz503Error1(Readyz503Error1 value) =>
        new(Optional<Readyz503Error1>.Some(value), default);

    private static GetReadinessError AsFallback(RawError value) => new(default, Optional<RawError>.Some(value));

    public bool TryGetReadyz503Error1([NotNullWhen(true)] out Readyz503Error1? value) =>
        _readyz503Error1Value.TryGetValue(out value);

    public TResult Match<TResult>(Func<Readyz503Error1, TResult> onReadyz503Error1,
        Func<RawError, TResult> otherwise) =>
        this switch
        {
            _ when TryGetReadyz503Error1(out var readyz503Error1Value) => onReadyz503Error1(readyz503Error1Value),
            _ when TryGetRawError(out var fallback) => otherwise(fallback),
            _ => throw new InvalidOperationException($"{nameof(GetReadinessError)} holds no value.")
        };

    public void Match(Action<Readyz503Error1> onReadyz503Error1, Action<RawError> otherwise)
    {
        if (TryGetReadyz503Error1(out var readyz503Error1Value)) onReadyz503Error1(readyz503Error1Value);
        else if (TryGetRawError(out var fallback)) otherwise(fallback);
        else throw new InvalidOperationException($"{nameof(GetReadinessError)} holds no value.");
    }

    private static Task<GetReadinessError> Create(FailedResponse response) =>
        response.StatusCode switch
        {
            503 => response.Json<Readyz503Error1>().As(AsReadyz503Error1),
            _ => response.RawBody().As(AsFallback)
        };

    internal static ApiErrorResponse<GetReadinessError> Response { get; } = new(Create);
}
