using System.Text.Json.Serialization;

namespace GavelHostApi.Models;

public record ApiJudgePauseRequest
{
    [JsonPropertyName("paused")]
    public required bool Paused { get; init; }
}
