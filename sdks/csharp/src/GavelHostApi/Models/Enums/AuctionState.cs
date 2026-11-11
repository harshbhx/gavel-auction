using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// State of the settlement of the lot.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<AuctionState>))]
public sealed record AuctionState : OpenStringEnum<AuctionState>
{
    private AuctionState(string value) : base(value)
    {
    }

    public static readonly AuctionState Held = new("HELD");

    public static readonly AuctionState Bidding = new("BIDDING");

    public static readonly AuctionState WinnerSelected = new("WINNER_SELECTED");

    public static readonly AuctionState Capturing = new("CAPTURING");

    public static readonly AuctionState Captured = new("CAPTURED");

    public static readonly AuctionState Voiding = new("VOIDING");

    public static readonly AuctionState Settled = new("SETTLED");

    public static readonly AuctionState FallbackRunnerUp = new("FALLBACK_RUNNER_UP");

    public static readonly AuctionState FailedNeedsReview = new("FAILED_NEEDS_REVIEW");

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
