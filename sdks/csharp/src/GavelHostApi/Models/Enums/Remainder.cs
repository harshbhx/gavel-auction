using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// What happened to the part of a captured hold beyond the price.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<Remainder>))]
public sealed record Remainder : OpenStringEnum<Remainder>
{
    private Remainder(string value) : base(value)
    {
    }

    public static readonly Remainder None = new("none");

    public static readonly Remainder Pending = new("pending");

    public static readonly Remainder Released = new("released");

    public static readonly Remainder Unreleased = new("unreleased");

    public TResult Match<TResult>(Func<TResult> onNone,
        Func<TResult> onPending,
        Func<TResult> onReleased,
        Func<TResult> onUnreleased,
        Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == None => onNone(),
            _ when this == Pending => onPending(),
            _ when this == Released => onReleased(),
            _ when this == Unreleased => onUnreleased(),
            _ => otherwise(Value)
        };

    public void Match(Action onNone, Action onPending, Action onReleased, Action onUnreleased, Action<string> otherwise)
    {
        if (this == None) onNone();
        else if (this == Pending) onPending();
        else if (this == Released) onReleased();
        else if (this == Unreleased) onUnreleased();
        else otherwise(Value);
    }
}
