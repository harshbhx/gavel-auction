using System;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Extensions;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models.AnyOf;

[JsonConverter(typeof(ApiJudgeRoomsBidsResponse21Converter))]
public record ApiJudgeRoomsBidsResponse21
{
    private readonly Optional<ApiJudgeRoomsBidsResponse2> _apiJudgeRoomsBidsResponse2Value;

    private readonly Optional<Error5> _error5Value;

    private readonly Optional<UnknownArm> _unknownValue;

    private ApiJudgeRoomsBidsResponse21(Optional<ApiJudgeRoomsBidsResponse2> apiJudgeRoomsBidsResponse2Value,
        Optional<Error5> error5Value,
        Optional<UnknownArm> unknownValue)
    {
        _apiJudgeRoomsBidsResponse2Value = apiJudgeRoomsBidsResponse2Value;
        _error5Value = error5Value;
        _unknownValue = unknownValue;
    }

    public static ApiJudgeRoomsBidsResponse21 ApiJudgeRoomsBidsResponse2(ApiJudgeRoomsBidsResponse2 value) =>
        new(Optional<ApiJudgeRoomsBidsResponse2>.Some(value), default, default);

    public static ApiJudgeRoomsBidsResponse21 Error5(Error5 value) =>
        new(default, Optional<Error5>.Some(value), default);

    internal static ApiJudgeRoomsBidsResponse21 Unknown(JsonElement value) =>
        new(default, default, Optional<UnknownArm>.Some(new UnknownArm(value)));

    public bool TryGetApiJudgeRoomsBidsResponse2([NotNullWhen(true)] out ApiJudgeRoomsBidsResponse2? value) =>
        _apiJudgeRoomsBidsResponse2Value.TryGetValue(out value);

    public bool TryGetError5([NotNullWhen(true)] out Error5? value) => _error5Value.TryGetValue(out value);

    public bool TryGetUnknown(out JsonElement value) => _unknownValue.TryGetValue(out value);

    public static implicit operator ApiJudgeRoomsBidsResponse21(ApiJudgeRoomsBidsResponse2 value) =>
        ApiJudgeRoomsBidsResponse2(value);

    public static implicit operator ApiJudgeRoomsBidsResponse21(Error5 value) => Error5(value);

    public TResult Match<TResult>(Func<ApiJudgeRoomsBidsResponse2, TResult> onApiJudgeRoomsBidsResponse2,
        Func<Error5, TResult> onError5,
        Func<JsonElement, TResult> otherwise) =>
        this switch
        {
            _ when TryGetApiJudgeRoomsBidsResponse2(
                out var apiJudgeRoomsBidsResponse2Value) => onApiJudgeRoomsBidsResponse2(
                apiJudgeRoomsBidsResponse2Value),
            _ when TryGetError5(out var error5Value) => onError5(error5Value),
            _ when TryGetUnknown(out var unknownValue) => otherwise(unknownValue),
            _ => throw new InvalidOperationException($"{nameof(ApiJudgeRoomsBidsResponse21)} holds no value.")
        };

    public void Match(Action<ApiJudgeRoomsBidsResponse2> onApiJudgeRoomsBidsResponse2,
        Action<Error5> onError5,
        Action<JsonElement> otherwise)
    {
        if (TryGetApiJudgeRoomsBidsResponse2(out var apiJudgeRoomsBidsResponse2Value)) onApiJudgeRoomsBidsResponse2(
            apiJudgeRoomsBidsResponse2Value);
        else if (TryGetError5(out var error5Value)) onError5(error5Value);
        else if (TryGetUnknown(out var unknownValue)) otherwise(unknownValue);
        else throw new InvalidOperationException($"{nameof(ApiJudgeRoomsBidsResponse21)} holds no value.");
    }
}

file sealed class ApiJudgeRoomsBidsResponse21Converter : JsonConverter<ApiJudgeRoomsBidsResponse21>
{
    public override ApiJudgeRoomsBidsResponse21 Read(ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options)
    {
        using var doc = JsonDocument.ParseValue(ref reader);
        var root = doc.RootElement;
        if (JsonSerializer.TryDeserialize<ApiJudgeRoomsBidsResponse2>(
            root,
            options,
            out var apiJudgeRoomsBidsResponse2Value))
        {
            return ApiJudgeRoomsBidsResponse21.ApiJudgeRoomsBidsResponse2(apiJudgeRoomsBidsResponse2Value);
        }
        if (JsonSerializer.TryDeserialize<Error5>(root, options, out var error5Value))
        {
            return ApiJudgeRoomsBidsResponse21.Error5(error5Value);
        }
        return ApiJudgeRoomsBidsResponse21.Unknown(root);
    }

    public override void Write(Utf8JsonWriter writer, ApiJudgeRoomsBidsResponse21 value, JsonSerializerOptions options)
    {
        if (value.TryGetApiJudgeRoomsBidsResponse2(out var apiJudgeRoomsBidsResponse2Value))
        {
            JsonSerializer.Serialize(writer, apiJudgeRoomsBidsResponse2Value, options);
        }
        else if (value.TryGetError5(out var error5Value))
        {
            JsonSerializer.Serialize(writer, error5Value, options);
        }
        else if (value.TryGetUnknown(out var unknownValue))
        {
            unknownValue.WriteTo(writer);
        }
        else
        {
            throw new JsonException($"{nameof(ApiJudgeRoomsBidsResponse21)} contains no valid value to serialize.");
        }
    }
}
