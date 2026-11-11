using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// One hold covers the whole event. Only <c>event</c> is accepted; <c>lot</c> is refused with 400 <c>bad_message</c>.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<HoldScope>))]
public sealed record HoldScope : OpenStringEnum<HoldScope>
{
    private HoldScope(string value) : base(value)
    {
    }

    public static readonly HoldScope Event = new("event");

    public TResult Match<TResult>(Func<TResult> onEvent, Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == Event => onEvent(),
            _ => otherwise(Value)
        };

    public void Match(Action onEvent, Action<string> otherwise)
    {
        if (this == Event) onEvent();
        else otherwise(Value);
    }
}
