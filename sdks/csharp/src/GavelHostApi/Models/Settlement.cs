using System.Text.Json.Serialization;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Models;

/// <summary>
/// Settlement progress, present once the lot ended.
/// </summary>
public record Settlement
{
    /// <summary>
    /// Revision counter of the settlement; it grows with every change.
    /// </summary>
    [JsonPropertyName("rev")]
    public required int Rev { get; init; }

    /// <summary>
    /// State of the settlement of the lot.
    /// </summary>
    [JsonPropertyName("auctionState")]
    public required AuctionState AuctionState { get; init; }

    /// <summary>
    /// The viewing bidder's own settlement state. Bidder sessions only.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("you")]
    public You? You { get; init; }

    /// <summary>
    /// The viewing bidder's own hold after the hammer. Never sent to screens, the auctioneer or other bidders.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("yourHold")]
    public YourHold? YourHold { get; init; }
}
