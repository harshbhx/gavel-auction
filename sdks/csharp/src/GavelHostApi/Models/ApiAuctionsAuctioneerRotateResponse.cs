using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record ApiAuctionsAuctioneerRotateResponse
{
    [JsonPropertyName("auctioneerLink")]
    [Format(FormatKind.Uri)]
    public required string AuctioneerLink { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
