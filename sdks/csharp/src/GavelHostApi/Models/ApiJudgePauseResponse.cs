using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ApiJudgePauseResponse
{
    [JsonPropertyName("paused")]
    public required bool Paused { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
