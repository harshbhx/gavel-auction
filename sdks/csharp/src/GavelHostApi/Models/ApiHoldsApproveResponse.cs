using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record ApiHoldsApproveResponse
{
    [JsonPropertyName("holdId")]
    public required string HoldId { get; init; }

    [JsonPropertyName("status")]
    public string Status { get; } = "HELD";

    [JsonPropertyName("ceilingCents")]
    [Minimum(1)]
    public required int CeilingCents { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
