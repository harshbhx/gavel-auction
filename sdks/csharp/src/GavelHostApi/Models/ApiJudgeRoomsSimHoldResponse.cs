using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ApiJudgeRoomsSimHoldResponse
{
    [JsonPropertyName("holdId")]
    public required string HoldId { get; init; }

    [JsonPropertyName("simulated")]
    public string Simulated { get; } = "True";

    [JsonPropertyName("ceilingCents")]
    public required int CeilingCents { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
