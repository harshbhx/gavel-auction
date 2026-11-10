using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ApiJudgeRoomsBidsResponse1
{
    [JsonPropertyName("accepted")]
    public string Accepted { get; } = "False";

    [JsonPropertyName("pending")]
    public string Pending { get; } = "True";

    [JsonPropertyName("mid")]
    public required string Mid { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
