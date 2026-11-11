using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ControlResponse
{
    /// <summary>
    /// Always true on success.
    /// </summary>
    [JsonPropertyName("ok")]
    public string Ok { get; } = "True";

    /// <summary>
    /// The controlId you sent.
    /// </summary>
    [JsonPropertyName("controlId")]
    public required string ControlId { get; init; }

    /// <summary>
    /// The hammer frame, present when the control ended the lot.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("hammer")]
    public object? Hammer { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
