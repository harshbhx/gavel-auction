using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// 400 ceiling_out_of_range (below 100 cents or above the host cap); 404 order_not_found; 409 hold_exists, raise_limit_reached, order_not_approved; 422 raise_too_small; 503 paypal_unavailable, kill_switch_engaged, payments_not_sandbox.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<HoldErrorCode>))]
public sealed record HoldErrorCode : OpenStringEnum<HoldErrorCode>
{
    private HoldErrorCode(string value) : base(value)
    {
    }

    public static readonly HoldErrorCode CeilingOutOfRange = new("ceiling_out_of_range");

    public static readonly HoldErrorCode HoldExists = new("hold_exists");

    public static readonly HoldErrorCode RaiseLimitReached = new("raise_limit_reached");

    public static readonly HoldErrorCode RaiseTooSmall = new("raise_too_small");

    public static readonly HoldErrorCode OrderNotFound = new("order_not_found");

    public static readonly HoldErrorCode OrderNotApproved = new("order_not_approved");

    public static readonly HoldErrorCode PaypalUnavailable = new("paypal_unavailable");

    public static readonly HoldErrorCode KillSwitchEngaged = new("kill_switch_engaged");

    public static readonly HoldErrorCode PaymentsNotSandbox = new("payments_not_sandbox");

    public TResult Match<TResult>(Func<TResult> onCeilingOutOfRange,
        Func<TResult> onHoldExists,
        Func<TResult> onRaiseLimitReached,
        Func<TResult> onRaiseTooSmall,
        Func<TResult> onOrderNotFound,
        Func<TResult> onOrderNotApproved,
        Func<TResult> onPaypalUnavailable,
        Func<TResult> onKillSwitchEngaged,
        Func<TResult> onPaymentsNotSandbox,
        Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == CeilingOutOfRange => onCeilingOutOfRange(),
            _ when this == HoldExists => onHoldExists(),
            _ when this == RaiseLimitReached => onRaiseLimitReached(),
            _ when this == RaiseTooSmall => onRaiseTooSmall(),
            _ when this == OrderNotFound => onOrderNotFound(),
            _ when this == OrderNotApproved => onOrderNotApproved(),
            _ when this == PaypalUnavailable => onPaypalUnavailable(),
            _ when this == KillSwitchEngaged => onKillSwitchEngaged(),
            _ when this == PaymentsNotSandbox => onPaymentsNotSandbox(),
            _ => otherwise(Value)
        };

    public void Match(Action onCeilingOutOfRange,
        Action onHoldExists,
        Action onRaiseLimitReached,
        Action onRaiseTooSmall,
        Action onOrderNotFound,
        Action onOrderNotApproved,
        Action onPaypalUnavailable,
        Action onKillSwitchEngaged,
        Action onPaymentsNotSandbox,
        Action<string> otherwise)
    {
        if (this == CeilingOutOfRange) onCeilingOutOfRange();
        else if (this == HoldExists) onHoldExists();
        else if (this == RaiseLimitReached) onRaiseLimitReached();
        else if (this == RaiseTooSmall) onRaiseTooSmall();
        else if (this == OrderNotFound) onOrderNotFound();
        else if (this == OrderNotApproved) onOrderNotApproved();
        else if (this == PaypalUnavailable) onPaypalUnavailable();
        else if (this == KillSwitchEngaged) onKillSwitchEngaged();
        else if (this == PaymentsNotSandbox) onPaymentsNotSandbox();
        else otherwise(Value);
    }
}
