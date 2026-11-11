using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// Lifecycle state of the auction, from SCHEDULED to DONE.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<AuctionStatus>))]
public sealed record AuctionStatus : OpenStringEnum<AuctionStatus>
{
    private AuctionStatus(string value) : base(value)
    {
    }

    public static readonly AuctionStatus Scheduled = new("SCHEDULED");

    public static readonly AuctionStatus Open = new("OPEN");

    public static readonly AuctionStatus Paused = new("PAUSED");

    public static readonly AuctionStatus Closing = new("CLOSING");

    public static readonly AuctionStatus Settling = new("SETTLING");

    public static readonly AuctionStatus Done = new("DONE");

    public TResult Match<TResult>(Func<TResult> onScheduled,
        Func<TResult> onOpen,
        Func<TResult> onPaused,
        Func<TResult> onClosing,
        Func<TResult> onSettling,
        Func<TResult> onDone,
        Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == Scheduled => onScheduled(),
            _ when this == Open => onOpen(),
            _ when this == Paused => onPaused(),
            _ when this == Closing => onClosing(),
            _ when this == Settling => onSettling(),
            _ when this == Done => onDone(),
            _ => otherwise(Value)
        };

    public void Match(Action onScheduled,
        Action onOpen,
        Action onPaused,
        Action onClosing,
        Action onSettling,
        Action onDone,
        Action<string> otherwise)
    {
        if (this == Scheduled) onScheduled();
        else if (this == Open) onOpen();
        else if (this == Paused) onPaused();
        else if (this == Closing) onClosing();
        else if (this == Settling) onSettling();
        else if (this == Done) onDone();
        else otherwise(Value);
    }
}
