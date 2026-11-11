using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// Stable code (hold failures, judge, operator and host-level answers, and the 429 of the code lookup and the join route). A plain string; may be a value outside ErrorCode.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<Error4>))]
public sealed record Error4 : OpenStringEnum<Error4>
{
    private Error4(string value) : base(value)
    {
    }

    public static readonly Error4 BidRejected = new("bid_rejected");

    public TResult Match<TResult>(Func<TResult> onBidRejected, Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == BidRejected => onBidRejected(),
            _ => otherwise(Value)
        };

    public void Match(Action onBidRejected, Action<string> otherwise)
    {
        if (this == BidRejected) onBidRejected();
        else otherwise(Value);
    }
}
