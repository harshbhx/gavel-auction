using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation.Attributes;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Models;

public record Roster
{
    /// <summary>
    /// 26 character id (Crockford base 32).
    /// </summary>
    [JsonPropertyName("bidderId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string BidderId { get; init; }

    /// <summary>
    /// Paddle number of the bidder.
    /// </summary>
    [JsonPropertyName("paddle")]
    [Minimum(1)]
    [Maximum(9999)]
    public required int Paddle { get; init; }

    /// <summary>
    /// Display name of the bidder.
    /// </summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>
    /// HELD when the bidder has a hold, otherwise NONE.
    /// </summary>
    [JsonPropertyName("hold")]
    public required Hold Hold { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
