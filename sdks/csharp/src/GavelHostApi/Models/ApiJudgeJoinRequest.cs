using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace GavelHostApi.Models;

public record ApiJudgeJoinRequest
{
    /// <summary>
    /// The join code, in any case; spaces, dashes and a GVL- prefix are ignored.
    /// </summary>
    [JsonPropertyName("code")]
    [StringLength(40, MinimumLength = 1)]
    public required string Code { get; init; }

    /// <summary>
    /// Display name. Control characters, invisible direction marks and angle brackets are refused.
    /// </summary>
    [JsonPropertyName("displayName")]
    [StringLength(64, MinimumLength = 1)]
    public required string DisplayName { get; init; }
}
