using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Models;

public record Readyz503Error1
{
    [JsonPropertyName("status")]
    public string Status { get; } = "unavailable";

    [JsonPropertyName("reason")]
    public required Reason Reason { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
