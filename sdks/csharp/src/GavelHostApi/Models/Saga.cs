using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record Saga
{
    [JsonPropertyName("auctionId")]
    public required string AuctionId { get; init; }

    [JsonPropertyName("lotId")]
    public required string LotId { get; init; }

    [JsonPropertyName("state")]
    public required string State { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
