using System.Collections.Generic;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record WarmupReportError
{
    /// <summary>
    /// True when every warm-up step succeeded.
    /// </summary>
    [JsonPropertyName("ok")]
    public required bool Ok { get; init; }

    /// <summary>
    /// Total time of the warm-up in milliseconds.
    /// </summary>
    [JsonPropertyName("elapsedMs")]
    public required int ElapsedMs { get; init; }

    /// <summary>
    /// One entry per warm-up step, in the order they ran.
    /// </summary>
    [JsonPropertyName("steps")]
    public required IReadOnlyList<Step> Steps { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
