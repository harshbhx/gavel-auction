using System;
using System.Diagnostics.CodeAnalysis;
using System.Threading.Tasks;
using GavelHostApi.Core.ErrorResponse;
using GavelHostApi.Core.Models;
using GavelHostApi.Models.AnyOf;

namespace GavelHostApi.Errors;

public sealed class PlaceJudgeBidError : ApiError
{
    private readonly Optional<ApiJudgeRoomsBidsResponse21> _apiJudgeRoomsBidsResponse21Value;

    private readonly Optional<Error5> _error5Value;

    private PlaceJudgeBidError(Optional<ApiJudgeRoomsBidsResponse21> apiJudgeRoomsBidsResponse21Value,
        Optional<Error5> error5Value,
        Optional<RawError> fallback) : base(fallback)
    {
        _apiJudgeRoomsBidsResponse21Value = apiJudgeRoomsBidsResponse21Value;
        _error5Value = error5Value;
    }

    private static PlaceJudgeBidError AsApiJudgeRoomsBidsResponse21(ApiJudgeRoomsBidsResponse21 value) =>
        new(Optional<ApiJudgeRoomsBidsResponse21>.Some(value), default, default);

    private static PlaceJudgeBidError AsError5(Error5 value) => new(default, Optional<Error5>.Some(value), default);

    private static PlaceJudgeBidError AsFallback(RawError value) =>
        new(default, default, Optional<RawError>.Some(value));

    public bool TryGetApiJudgeRoomsBidsResponse21([NotNullWhen(true)] out ApiJudgeRoomsBidsResponse21? value) =>
        _apiJudgeRoomsBidsResponse21Value.TryGetValue(out value);

    public bool TryGetError5([NotNullWhen(true)] out Error5? value) => _error5Value.TryGetValue(out value);

    public TResult Match<TResult>(Func<ApiJudgeRoomsBidsResponse21, TResult> onApiJudgeRoomsBidsResponse21,
        Func<Error5, TResult> onError5,
        Func<RawError, TResult> otherwise) =>
        this switch
        {
            _ when TryGetApiJudgeRoomsBidsResponse21(
                out var apiJudgeRoomsBidsResponse21Value) => onApiJudgeRoomsBidsResponse21(
                apiJudgeRoomsBidsResponse21Value),
            _ when TryGetError5(out var error5Value) => onError5(error5Value),
            _ when TryGetRawError(out var fallback) => otherwise(fallback),
            _ => throw new InvalidOperationException($"{nameof(PlaceJudgeBidError)} holds no value.")
        };

    public void Match(Action<ApiJudgeRoomsBidsResponse21> onApiJudgeRoomsBidsResponse21,
        Action<Error5> onError5,
        Action<RawError> otherwise)
    {
        if (TryGetApiJudgeRoomsBidsResponse21(out var apiJudgeRoomsBidsResponse21Value)) onApiJudgeRoomsBidsResponse21(
            apiJudgeRoomsBidsResponse21Value);
        else if (TryGetError5(out var error5Value)) onError5(error5Value);
        else if (TryGetRawError(out var fallback)) otherwise(fallback);
        else throw new InvalidOperationException($"{nameof(PlaceJudgeBidError)} holds no value.");
    }

    private static Task<PlaceJudgeBidError> Create(FailedResponse response) =>
        response.StatusCode switch
        {
            400 or 401 or 403 or 404 or 410 or 413 or 415 or 429 or 500 or 503 => response.Json<Error5>().As(AsError5),
            409 => response.Json<ApiJudgeRoomsBidsResponse21>().As(AsApiJudgeRoomsBidsResponse21),
            _ => response.RawBody().As(AsFallback)
        };

    internal static ApiErrorResponse<PlaceJudgeBidError> Response { get; } = new(Create);
}
