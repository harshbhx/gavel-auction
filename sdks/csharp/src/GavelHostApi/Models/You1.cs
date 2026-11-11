using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

/// <summary>
/// The viewing bidder's own ceiling and high bid. Bidder sessions only.
/// </summary>
public record You1
{
    /// <summary>
    /// 26 character id (Crockford base 32).
    /// </summary>
    [JsonPropertyName("bidderId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string BidderId { get; init; }

    /// <summary>
    /// Money in integer US cents. There are no decimals anywhere in the API.
    /// </summary>
    [JsonPropertyName("ceiling")]
    [Minimum(0)]
    public required int Ceiling { get; init; }

    /// <summary>
    /// This bidder's highest accepted amount, absent before their first accepted bid.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("highBid")]
    [Minimum(0)]
    public int? HighBid { get; init; }
}
