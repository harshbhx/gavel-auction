using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record CreateAuctionResponse
{
    /// <summary>
    /// 26 character id (Crockford base 32).
    /// </summary>
    [JsonPropertyName("auctionId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string AuctionId { get; init; }

    /// <summary>
    /// Six letters and digits without look-alikes (no 0, O, 1, I, L).
    /// </summary>
    [JsonPropertyName("joinCode")]
    [RegularExpression("^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$")]
    public required string JoinCode { get; init; }

    /// <summary>
    /// Title of the lot, as given in the request.
    /// </summary>
    [JsonPropertyName("lotTitle")]
    public required string LotTitle { get; init; }

    /// <summary>
    /// Link to the auctioneer console. The auctioneer token is in the URL fragment.
    /// </summary>
    [JsonPropertyName("auctioneerLink")]
    [Format(FormatKind.Uri)]
    public required string AuctioneerLink { get; init; }

    /// <summary>
    /// Link to the projector screen. The screen token is in the URL fragment.
    /// </summary>
    [JsonPropertyName("screenLink")]
    [Format(FormatKind.Uri)]
    public required string ScreenLink { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
