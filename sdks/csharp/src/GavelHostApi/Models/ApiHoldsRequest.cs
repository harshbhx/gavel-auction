using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record ApiHoldsRequest
{
    /// <summary>
    /// 26 character id (Crockford base 32).
    /// </summary>
    [JsonPropertyName("auctionId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string AuctionId { get; init; }

    /// <summary>
    /// Highest amount this bidder allows, in whole cents: at least 100 and at most the host cap (<c>maxCeilingCents</c> of the room snapshot). Not limited to the preset ceilings.
    /// </summary>
    [JsonPropertyName("ceilingCents")]
    [Minimum(100)]
    public required int CeilingCents { get; init; }
}
