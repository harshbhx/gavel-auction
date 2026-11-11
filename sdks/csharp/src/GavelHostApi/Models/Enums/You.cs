using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// The viewing bidder's own settlement state. Bidder sessions only.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<You>))]
public sealed record You : OpenStringEnum<You>
{
    private You(string value) : base(value)
    {
    }

    public static readonly You Held = new("HELD");

    public static readonly You Bidding = new("BIDDING");

    public static readonly You WinnerSelected = new("WINNER_SELECTED");

    public static readonly You Capturing = new("CAPTURING");

    public static readonly You Captured = new("CAPTURED");

    public static readonly You Voiding = new("VOIDING");

    public static readonly You Settled = new("SETTLED");

    public static readonly You FallbackRunnerUp = new("FALLBACK_RUNNER_UP");

    public static readonly You FailedNeedsReview = new("FAILED_NEEDS_REVIEW");

    public TResult Match<TResult>(Func<TResult> onHeld,
        Func<TResult> onBidding,
        Func<TResult> onWinnerSelected,
        Func<TResult> onCapturing,
        Func<TResult> onCaptured,
        Func<TResult> onVoiding,
        Func<TResult> onSettled,
        Func<TResult> onFallbackRunnerUp,
        Func<TResult> onFailedNeedsReview,
        Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == Held => onHeld(),
            _ when this == Bidding => onBidding(),
            _ when this == WinnerSelected => onWinnerSelected(),
            _ when this == Capturing => onCapturing(),
            _ when this == Captured => onCaptured(),
            _ when this == Voiding => onVoiding(),
            _ when this == Settled => onSettled(),
            _ when this == FallbackRunnerUp => onFallbackRunnerUp(),
            _ when this == FailedNeedsReview => onFailedNeedsReview(),
            _ => otherwise(Value)
        };

    public void Match(Action onHeld,
        Action onBidding,
        Action onWinnerSelected,
        Action onCapturing,
        Action onCaptured,
        Action onVoiding,
        Action onSettled,
        Action onFallbackRunnerUp,
        Action onFailedNeedsReview,
        Action<string> otherwise)
    {
        if (this == Held) onHeld();
        else if (this == Bidding) onBidding();
        else if (this == WinnerSelected) onWinnerSelected();
        else if (this == Capturing) onCapturing();
        else if (this == Captured) onCaptured();
        else if (this == Voiding) onVoiding();
        else if (this == Settled) onSettled();
        else if (this == FallbackRunnerUp) onFallbackRunnerUp();
        else if (this == FailedNeedsReview) onFailedNeedsReview();
        else otherwise(Value);
    }
}
