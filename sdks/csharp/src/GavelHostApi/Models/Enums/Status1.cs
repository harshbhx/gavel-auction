using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// Status of the hold.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<Status1>))]
public sealed record Status1 : OpenStringEnum<Status1>
{
    private Status1(string value) : base(value)
    {
    }

    public static readonly Status1 PendingApproval = new("PENDING_APPROVAL");

    public static readonly Status1 Held = new("HELD");

    public static readonly Status1 Captured = new("CAPTURED");

    public static readonly Status1 Voided = new("VOIDED");

    public static readonly Status1 Expired = new("EXPIRED");

    public static readonly Status1 Denied = new("DENIED");

    public static readonly Status1 Unknown = new("UNKNOWN");

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
