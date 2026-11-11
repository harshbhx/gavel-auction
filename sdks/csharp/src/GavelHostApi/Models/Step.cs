using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record Step
{
    /// <summary>
    /// Name of the warm-up step.
    /// </summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>
    /// True when this step succeeded.
    /// </summary>
    [JsonPropertyName("ok")]
    public required bool Ok { get; init; }

    /// <summary>
    /// Time this step took in milliseconds.
    /// </summary>
    [JsonPropertyName("ms")]
    public required int Ms { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
