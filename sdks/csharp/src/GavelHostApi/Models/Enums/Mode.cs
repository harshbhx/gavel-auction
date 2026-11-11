using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// Bidding mode. Only <c>english</c> is accepted; the host refuses any other mode with 400 <c>bad_message</c>. Defaults to english.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<Mode>))]
public sealed record Mode : OpenStringEnum<Mode>
{
    private Mode(string value) : base(value)
    {
    }

    public static readonly Mode English = new("english");

    public TResult Match<TResult>(Func<TResult> onEnglish, Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == English => onEnglish(),
            _ => otherwise(Value)
        };

    public void Match(Action onEnglish, Action<string> otherwise)
    {
        if (this == English) onEnglish();
        else otherwise(Value);
    }
}
