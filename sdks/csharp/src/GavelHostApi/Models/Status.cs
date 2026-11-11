using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record Status
{
    /// <summary>
    /// Always <c>ok</c> when the host answers.
    /// </summary>
    [JsonPropertyName("status")]
    public string StatusValue { get; } = "ok";

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
