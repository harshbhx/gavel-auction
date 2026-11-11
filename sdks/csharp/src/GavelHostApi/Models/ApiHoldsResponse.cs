using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation.Attributes;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Models;

public record ApiHoldsResponse
{
    [JsonPropertyName("holdId")]
    public required string HoldId { get; init; }

    [JsonPropertyName("status")]
    public required HoldStatus Status { get; init; }

    [JsonPropertyName("ceilingCents")]
    [Minimum(1)]
    public required int CeilingCents { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
