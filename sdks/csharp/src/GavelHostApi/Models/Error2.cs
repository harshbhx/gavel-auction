using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

/// <summary>
/// Operator and host-level answers, which carry only an error code.
/// </summary>
public record Error2
{
    /// <summary>
    /// Stable code.
    /// </summary>
    [JsonPropertyName("error")]
    public required string Error { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
