using System.Collections.Generic;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record OpsAuctionsVoidAllResponse
{
    [JsonPropertyName("status")]
    public string Status { get; } = "done";

    /// <summary>
    /// Hold id to the outcome the payments package recorded.
    /// </summary>
    [JsonPropertyName("holds")]
    public required IReadOnlyDictionary<string, string> Holds { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
