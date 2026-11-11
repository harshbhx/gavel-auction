using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ApiAuctionsKillResponse
{
    [JsonPropertyName("ok")]
    public string Ok { get; } = "True";

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("controlId")]
    public string? ControlId { get; init; }

    [JsonPropertyName("state")]
    public required State State { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
