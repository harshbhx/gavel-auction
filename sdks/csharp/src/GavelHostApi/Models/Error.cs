using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

/// <summary>
/// Core, hold authentication and state, and judge failures, with a code and a message.
/// </summary>
public record Error
{
    /// <summary>
    /// Text for a person.
    /// </summary>
    [JsonPropertyName("message")]
    public required string Message { get; init; }

    /// <summary>
    /// Stable code.
    /// </summary>
    [JsonPropertyName("code")]
    public required string Code { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
