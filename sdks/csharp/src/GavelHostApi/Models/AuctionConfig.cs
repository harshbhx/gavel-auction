using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Validation.Attributes;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Models;

/// <summary>
/// Settings of one auction. Amounts are in cents, durations in milliseconds.
/// </summary>
public record AuctionConfig
{
    /// <summary>
    /// Bidding mode. Only <c>english</c> is accepted; the host refuses any other mode with 400 <c>bad_message</c>. Defaults to english.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("mode")]
    public Mode? Mode { get; init; } = Mode.English;

    /// <summary>
    /// Currency of every amount. Only USD is accepted.
    /// </summary>
    [JsonPropertyName("currency")]
    public string Currency { get; } = "USD";

    /// <summary>
    /// Reserve price in cents (at least 100, at most 99999999999).
    /// </summary>
    [JsonPropertyName("reserve")]
    [Minimum(100)]
    [Maximum(2147483647)]
    public required int Reserve { get; init; }

    /// <summary>
    /// Smallest raise in cents (at most 99999999999).
    /// </summary>
    [JsonPropertyName("minIncrement")]
    [Minimum(1)]
    [Maximum(2147483647)]
    public required int MinIncrement { get; init; }

    /// <summary>
    /// End of the lot, in epoch milliseconds. Must be strictly after the host's clock at creation and at most 24 hours ahead (400 <c>bad_message</c> otherwise). The value in the example is a placeholder: use the current time plus a few minutes.
    /// </summary>
    [JsonPropertyName("endTs")]
    public required long EndTs { get; init; }

    /// <summary>
    /// A bid this close to the end extends the lot.
    /// </summary>
    [JsonPropertyName("softCloseWindowMs")]
    [Minimum(0)]
    [Maximum(600000)]
    public required int SoftCloseWindowMs { get; init; }

    /// <summary>
    /// How long a soft close extends the lot, in milliseconds.
    /// </summary>
    [JsonPropertyName("softCloseExtensionMs")]
    [Minimum(0)]
    [Maximum(600000)]
    public required int SoftCloseExtensionMs { get; init; }

    /// <summary>
    /// Most times the lot can be extended by soft close.
    /// </summary>
    [JsonPropertyName("maxExtensions")]
    [Minimum(0)]
    [Maximum(50)]
    public required int MaxExtensions { get; init; }

    /// <summary>
    /// Strictly ascending suggested ceiling amounts in cents, none below the reserve. A bidder may choose any ceiling from the minimum to the host cap, so these are suggestions, not the only allowed amounts.
    /// </summary>
    [JsonPropertyName("ceilingPresets")]
    [MinLength(1)]
    [MaxLength(8)]
    public required IReadOnlyList<int> CeilingPresets { get; init; }

    /// <summary>
    /// Spoken bids below this confidence need the bidder to confirm.
    /// </summary>
    [JsonPropertyName("confirmConfidenceThreshold")]
    [Minimum(0.0)]
    [Maximum(1.0)]
    public required double ConfirmConfidenceThreshold { get; init; }

    /// <summary>
    /// Milliseconds after closing begins before the host hammers the lot by itself. When absent, the auctioneer hammers by hand.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("autoHammerDelayMs")]
    [Minimum(0)]
    public int? AutoHammerDelayMs { get; init; }

    /// <summary>
    /// One hold covers the whole event. Only <c>event</c> is accepted; <c>lot</c> is refused with 400 <c>bad_message</c>.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("holdScope")]
    public HoldScope? HoldScope { get; init; }
}
