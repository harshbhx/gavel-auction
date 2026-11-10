using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// HELD when the bidder has a hold, otherwise NONE.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<Hold>))]
public sealed record Hold : OpenStringEnum<Hold>
{
    private Hold(string value) : base(value)
    {
    }

    public static readonly Hold Held = new("HELD");

    public static readonly Hold None = new("NONE");

    public TResult Match<TResult>(Func<TResult> onHeld, Func<TResult> onNone, Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == Held => onHeld(),
            _ when this == None => onNone(),
            _ => otherwise(Value)
        };

    public void Match(Action onHeld, Action onNone, Action<string> otherwise)
    {
        if (this == Held) onHeld();
        else if (this == None) onNone();
        else otherwise(Value);
    }
}
