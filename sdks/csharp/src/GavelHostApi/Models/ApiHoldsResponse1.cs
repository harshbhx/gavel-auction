using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ApiHoldsResponse1
{
    [JsonPropertyName("holdId")]
    public required string HoldId { get; init; }

    [JsonPropertyName("released")]
    public string Released { get; } = "True";

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
