using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ApiAuctionsReceiptResponse
{
    /// <summary>
    /// 26 character id (Crockford base 32).
    /// </summary>
    [JsonPropertyName("bidderId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string BidderId { get; init; }

    /// <summary>
    /// Room state for one viewer. Fields not listed here may appear; clients must ignore what they do not know. Private fields (<c>you</c>, <c>yourHold</c>, ceilings) appear only for the bidder they belong to.
    /// </summary>
    [JsonPropertyName("snapshot")]
    public required RoomSnapshot Snapshot { get; init; }

    /// <summary>
    /// Milliseconds since the Unix epoch.
    /// </summary>
    [JsonPropertyName("expiresAt")]
    public required int ExpiresAt { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
