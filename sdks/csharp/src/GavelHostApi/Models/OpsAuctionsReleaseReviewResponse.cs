using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record OpsAuctionsReleaseReviewResponse
{
    [JsonPropertyName("status")]
    public string Status { get; } = "released";

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
