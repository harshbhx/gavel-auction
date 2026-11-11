using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

/// <summary>
/// Result of the lot, present once it was hammered.
/// </summary>
public record Hammer
{
    /// <summary>
    /// Bidder id of the winner, or null when the lot did not sell.
    /// </summary>
    [JsonPropertyName("winnerId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string? WinnerId { get; init; }

    /// <summary>
    /// Money in integer US cents. There are no decimals anywhere in the API.
    /// </summary>
    [JsonPropertyName("price")]
    [Minimum(0)]
    public required int Price { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
