using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ApiJudgeRoomsCloseResponse
{
    [JsonPropertyName("closed")]
    public string Closed { get; } = "True";

    /// <summary>
    /// True when the room was already closed before this call.
    /// </summary>
    [JsonPropertyName("alreadyClosed")]
    public required bool AlreadyClosed { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
