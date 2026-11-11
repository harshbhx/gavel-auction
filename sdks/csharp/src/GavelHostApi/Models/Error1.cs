using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

/// <summary>
/// Hold, judge and lookup failures, with an error code and a message.
/// </summary>
public record Error1
{
    /// <summary>
    /// Text for a person.
    /// </summary>
    [JsonPropertyName("message")]
    public required string Message { get; init; }

    /// <summary>
    /// Stable code.
    /// </summary>
    [JsonPropertyName("error")]
    public required string Error { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
