using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record ApiJudgeRoomsSimHoldRequest
{
    /// <summary>
    /// Whole cents, at least 100 and at most the room's ceiling cap.
    /// </summary>
    [JsonPropertyName("ceilingCents")]
    [Minimum(100)]
    public required int CeilingCents { get; init; }

    /// <summary>
    /// Display name. Control characters, invisible direction marks and angle brackets are refused.
    /// </summary>
    [JsonPropertyName("name")]
    [StringLength(64, MinimumLength = 1)]
    public required string Name { get; init; }
}
