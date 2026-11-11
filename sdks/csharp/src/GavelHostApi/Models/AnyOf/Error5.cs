using System;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Extensions;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models.AnyOf;

/// <summary>
/// The error body. The stable code is in <c>code</c> on the core routes, in <c>error</c> on the operator routes and the host-level answers, and in both on the judge routes; the hold routes use <c>error</c> for hold failures and <c>code</c> for authentication and state failures. Read <c>code ?? error</c>. <c>message</c> is present on the core, hold and judge routes, and absent on the operator routes and host-level answers. 413 and 415 use <c>bad_message</c>. See "Errors" in the description for the table per family.
/// </summary>
[JsonConverter(typeof(Error5Converter))]
public record Error5
{
    private readonly Optional<Error> _errorValue;

    private readonly Optional<Error1> _error1Value;

    private readonly Optional<Error2> _error2Value;

    private readonly Optional<UnknownArm> _unknownValue;

    private Error5(Optional<Error> errorValue,
        Optional<Error1> error1Value,
        Optional<Error2> error2Value,
        Optional<UnknownArm> unknownValue)
    {
        _errorValue = errorValue;
        _error1Value = error1Value;
        _error2Value = error2Value;
        _unknownValue = unknownValue;
    }

    public static Error5 Error(Error value) => new(Optional<Error>.Some(value), default, default, default);

    public static Error5 Error1(Error1 value) => new(default, Optional<Error1>.Some(value), default, default);

    public static Error5 Error2(Error2 value) => new(default, default, Optional<Error2>.Some(value), default);

    internal static Error5 Unknown(JsonElement value) =>
        new(default, default, default, Optional<UnknownArm>.Some(new UnknownArm(value)));

    public bool TryGetError([NotNullWhen(true)] out Error? value) => _errorValue.TryGetValue(out value);

    public bool TryGetError1([NotNullWhen(true)] out Error1? value) => _error1Value.TryGetValue(out value);

    public bool TryGetError2([NotNullWhen(true)] out Error2? value) => _error2Value.TryGetValue(out value);

    public bool TryGetUnknown(out JsonElement value) => _unknownValue.TryGetValue(out value);

    public static implicit operator Error5(Error value) => Error(value);

    public static implicit operator Error5(Error1 value) => Error1(value);

    public static implicit operator Error5(Error2 value) => Error2(value);

    public TResult Match<TResult>(Func<Error, TResult> onError,
        Func<Error1, TResult> onError1,
        Func<Error2, TResult> onError2,
        Func<JsonElement, TResult> otherwise) =>
        this switch
        {
            _ when TryGetError(out var errorValue) => onError(errorValue),
            _ when TryGetError1(out var error1Value) => onError1(error1Value),
            _ when TryGetError2(out var error2Value) => onError2(error2Value),
            _ when TryGetUnknown(out var unknownValue) => otherwise(unknownValue),
            _ => throw new InvalidOperationException($"{nameof(Error5)} holds no value.")
        };

    public void Match(Action<Error> onError,
        Action<Error1> onError1,
        Action<Error2> onError2,
        Action<JsonElement> otherwise)
    {
        if (TryGetError(out var errorValue)) onError(errorValue);
        else if (TryGetError1(out var error1Value)) onError1(error1Value);
        else if (TryGetError2(out var error2Value)) onError2(error2Value);
        else if (TryGetUnknown(out var unknownValue)) otherwise(unknownValue);
        else throw new InvalidOperationException($"{nameof(Error5)} holds no value.");
    }
}

file sealed class Error5Converter : JsonConverter<Error5>
{
    public override Error5 Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var doc = JsonDocument.ParseValue(ref reader);
        var root = doc.RootElement;
        if (JsonSerializer.TryDeserialize<Error>(root, options, out var errorValue))
        {
            return Error5.Error(errorValue);
        }
        if (JsonSerializer.TryDeserialize<Error1>(root, options, out var error1Value))
        {
            return Error5.Error1(error1Value);
        }
        if (JsonSerializer.TryDeserialize<Error2>(root, options, out var error2Value))
        {
            return Error5.Error2(error2Value);
        }
        return Error5.Unknown(root);
    }

    public override void Write(Utf8JsonWriter writer, Error5 value, JsonSerializerOptions options)
    {
        if (value.TryGetError(out var errorValue))
        {
            JsonSerializer.Serialize(writer, errorValue, options);
        }
        else if (value.TryGetError1(out var error1Value))
        {
            JsonSerializer.Serialize(writer, error1Value, options);
        }
        else if (value.TryGetError2(out var error2Value))
        {
            JsonSerializer.Serialize(writer, error2Value, options);
        }
        else if (value.TryGetUnknown(out var unknownValue))
        {
            unknownValue.WriteTo(writer);
        }
        else
        {
            throw new JsonException($"{nameof(Error5)} contains no valid value to serialize.");
        }
    }
}
