using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

/// <summary>
/// The <c>state</c> frame of the WebSocket protocol, returned over HTTP.
/// </summary>
public record StateFrame
{
    /// <summary>
    /// Protocol version of the frame.
    /// </summary>
    [JsonPropertyName("v")]
    public int V { get; } = 1;

    /// <summary>
    /// Frame type. Always state.
    /// </summary>
    [JsonPropertyName("t")]
    public string T { get; } = "state";

    /// <summary>
    /// Sequence number of the last event the snapshot includes.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("seq")]
    public int? Seq { get; init; }

    /// <summary>
    /// Host clock when the frame was built (every server frame carries it).
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("ts")]
    public int? Ts { get; init; }

    /// <summary>
    /// Room state for one viewer. Fields not listed here may appear; clients must ignore what they do not know. Private fields (<c>you</c>, <c>yourHold</c>, ceilings) appear only for the bidder they belong to.
    /// </summary>
    [JsonPropertyName("snapshot")]
    public required RoomSnapshot Snapshot { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
