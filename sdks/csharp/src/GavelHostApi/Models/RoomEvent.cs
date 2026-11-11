using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

/// <summary>
/// One logged event. <c>seq</c> is always there. The other fields depend on <c>type</c> (<c>auction_created</c>, <c>bidder_registered</c>, <c>ceiling_raised</c>, <c>bid_accepted</c>, <c>control</c>, <c>state_changed</c>, <c>hammered</c> and others); a screen sees only <c>seq</c> for non-public types.
/// </summary>
public record RoomEvent
{
    /// <summary>
    /// Position of the event in the ledger, starting at 1.
    /// </summary>
    [JsonPropertyName("seq")]
    [Minimum(1)]
    public required int Seq { get; init; }

    /// <summary>
    /// Event type, for example auction_created or bid_accepted. Absent for non-public events seen by a screen.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("type")]
    public string? Type { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
