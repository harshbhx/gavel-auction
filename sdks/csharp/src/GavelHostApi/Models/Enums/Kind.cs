using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

[JsonConverter(typeof(StringEnumConverter<Kind>))]
public sealed record Kind : OpenStringEnum<Kind>
{
    private Kind(string value) : base(value)
    {
    }

    public static readonly Kind Payments = new("payments");

    public static readonly Kind PaymentsGlobal = new("payments-global");

    public static readonly Kind Roomlog = new("roomlog");

    public TResult Match<TResult>(Func<TResult> onPayments,
        Func<TResult> onPaymentsGlobal,
        Func<TResult> onRoomlog,
        Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == Payments => onPayments(),
            _ when this == PaymentsGlobal => onPaymentsGlobal(),
            _ when this == Roomlog => onRoomlog(),
            _ => otherwise(Value)
        };

    public void Match(Action onPayments, Action onPaymentsGlobal, Action onRoomlog, Action<string> otherwise)
    {
        if (this == Payments) onPayments();
        else if (this == PaymentsGlobal) onPaymentsGlobal();
        else if (this == Roomlog) onRoomlog();
        else otherwise(Value);
    }
}
