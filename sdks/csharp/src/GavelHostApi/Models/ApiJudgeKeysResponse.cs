using System.Collections.Generic;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ApiJudgeKeysResponse
{
    [JsonPropertyName("keys")]
    public required IReadOnlyList<Key> Keys { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
