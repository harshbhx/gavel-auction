using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

[JsonConverter(typeof(StringEnumConverter<ListEnum>))]
public sealed record ListEnum : OpenStringEnum<ListEnum>
{
    private ListEnum(string value) : base(value)
    {
    }

    public static readonly ListEnum _1 = new("1");

    public TResult Match<TResult>(Func<TResult> on_1, Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == _1 => on_1(),
            _ => otherwise(Value)
        };

    public void Match(Action on_1, Action<string> otherwise)
    {
        if (this == _1) on_1();
        else otherwise(Value);
    }
}
