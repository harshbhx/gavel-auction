using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ApiJudgeCapabilitiesResponse
{
    /// <summary>
    /// Judge rooms are switched on for this host.
    /// </summary>
    [JsonPropertyName("judgeRooms")]
    public required bool JudgeRooms { get; init; }

    /// <summary>
    /// Rooms are on, not paused and under the live-room cap.
    /// </summary>
    [JsonPropertyName("accepting")]
    public required bool Accepting { get; init; }

    /// <summary>
    /// The simulated-hold route is available.
    /// </summary>
    [JsonPropertyName("simHolds")]
    public required bool SimHolds { get; init; }

    /// <summary>
    /// Present and true only when the host has a judge key set.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("keyed")]
    public bool? Keyed { get; init; }

    /// <summary>
    /// Present and true only when a live speech provider is configured for the audio route. The provider name and its key are never reported.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("voice")]
    public bool? Voice { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
