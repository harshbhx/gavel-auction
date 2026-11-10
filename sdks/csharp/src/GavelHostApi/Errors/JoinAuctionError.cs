using System;
using System.Diagnostics.CodeAnalysis;
using System.Threading.Tasks;
using GavelHostApi.Core.ErrorResponse;
using GavelHostApi.Core.Models;
using GavelHostApi.Models.AnyOf;

namespace GavelHostApi.Errors;

public sealed class JoinAuctionError : ApiError
{
    private readonly Optional<Error5> _error5Value;

    private JoinAuctionError(Optional<Error5> error5Value, Optional<RawError> fallback) : base(fallback)
    {
        _error5Value = error5Value;
    }

    private static JoinAuctionError AsError5(Error5 value) => new(Optional<Error5>.Some(value), default);

    private static JoinAuctionError AsFallback(RawError value) => new(default, Optional<RawError>.Some(value));

    public bool TryGetError5([NotNullWhen(true)] out Error5? value) => _error5Value.TryGetValue(out value);

    public TResult Match<TResult>(Func<Error5, TResult> onError5, Func<RawError, TResult> otherwise) =>
        this switch
        {
            _ when TryGetError5(out var error5Value) => onError5(error5Value),
            _ when TryGetRawError(out var fallback) => otherwise(fallback),
            _ => throw new InvalidOperationException($"{nameof(JoinAuctionError)} holds no value.")
        };

    public void Match(Action<Error5> onError5, Action<RawError> otherwise)
    {
        if (TryGetError5(out var error5Value)) onError5(error5Value);
        else if (TryGetRawError(out var fallback)) otherwise(fallback);
        else throw new InvalidOperationException($"{nameof(JoinAuctionError)} holds no value.");
    }

    private static Task<JoinAuctionError> Create(FailedResponse response) =>
        response.StatusCode switch
        {
            400 or 401 or 403 or 404 or 409 or 413 or 415 or 429 or 500 => response.Json<Error5>().As(AsError5),
            _ => response.RawBody().As(AsFallback)
        };

    internal static ApiErrorResponse<JoinAuctionError> Response { get; } = new(Create);
}
