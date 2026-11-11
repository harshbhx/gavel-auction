using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

[JsonConverter(typeof(StringEnumConverter<HoldStatus>))]
public sealed record HoldStatus : OpenStringEnum<HoldStatus>
{
    private HoldStatus(string value) : base(value)
    {
    }

    public static readonly HoldStatus PendingApproval = new("PENDING_APPROVAL");

    public static readonly HoldStatus Held = new("HELD");

    public static readonly HoldStatus Captured = new("CAPTURED");

    public static readonly HoldStatus Voided = new("VOIDED");

    public static readonly HoldStatus Expired = new("EXPIRED");

    public static readonly HoldStatus Denied = new("DENIED");

    public static readonly HoldStatus Unknown = new("UNKNOWN");

    public TResult Match<TResult>(Func<TResult> onPendingApproval,
        Func<TResult> onHeld,
        Func<TResult> onCaptured,
        Func<TResult> onVoided,
        Func<TResult> onExpired,
        Func<TResult> onDenied,
        Func<TResult> onUnknown,
        Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == PendingApproval => onPendingApproval(),
            _ when this == Held => onHeld(),
            _ when this == Captured => onCaptured(),
            _ when this == Voided => onVoided(),
            _ when this == Expired => onExpired(),
            _ when this == Denied => onDenied(),
            _ when this == Unknown => onUnknown(),
            _ => otherwise(Value)
        };

    public void Match(Action onPendingApproval,
        Action onHeld,
        Action onCaptured,
        Action onVoided,
        Action onExpired,
        Action onDenied,
        Action onUnknown,
        Action<string> otherwise)
    {
        if (this == PendingApproval) onPendingApproval();
        else if (this == Held) onHeld();
        else if (this == Captured) onCaptured();
        else if (this == Voided) onVoided();
        else if (this == Expired) onExpired();
        else if (this == Denied) onDenied();
        else if (this == Unknown) onUnknown();
        else otherwise(Value);
    }
}
