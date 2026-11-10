using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Validation.Attributes;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Models;

/// <summary>
/// The viewing bidder's own hold after the hammer. Never sent to screens, the auctioneer or other bidders.
/// </summary>
public record YourHold
{
    /// <summary>
    /// 26 character id (Crockford base 32).
    /// </summary>
    [JsonPropertyName("bidderId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string BidderId { get; init; }

    /// <summary>
    /// Last 6 characters of the hold id only.
    /// </summary>
    [JsonPropertyName("idSuffix")]
    [MaxLength(6)]
    public required string IdSuffix { get; init; }

    /// <summary>
    /// Status of the hold.
    /// </summary>
    [JsonPropertyName("status")]
    public required Status1 Status { get; init; }

    /// <summary>
    /// Money in integer US cents. There are no decimals anywhere in the API.
    /// </summary>
    [JsonPropertyName("ceilingCents")]
    [Minimum(0)]
    public required int CeilingCents { get; init; }

    /// <summary>
    /// Cents captured from the hold (sandbox only).
    /// </summary>
    [JsonPropertyName("capturedCents")]
    [Minimum(0)]
    public required int CapturedCents { get; init; }

    /// <summary>
    /// Cents of the hold released.
    /// </summary>
    [JsonPropertyName("releasedCents")]
    [Minimum(0)]
    public required int ReleasedCents { get; init; }

    /// <summary>
    /// What happened to the part of a captured hold beyond the price.
    /// </summary>
    [JsonPropertyName("remainder")]
    public required Remainder Remainder { get; init; }
}
