using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

/// <summary>
/// Fundraiser goal, present only when one was set.
/// </summary>
public record Fundraiser
{
    /// <summary>
    /// Goal in cents.
    /// </summary>
    [JsonPropertyName("goalCents")]
    [Minimum(1)]
    public required int GoalCents { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
