using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ApiJudgeRoomsBidsResponse
{
    [JsonPropertyName("accepted")]
    public string Accepted { get; } = "True";

    [JsonPropertyName("mid")]
    public required string Mid { get; init; }

    [JsonPropertyName("bidId")]
    public required string BidId { get; init; }

    /// <summary>
    /// The accepted bid in cents.
    /// </summary>
    [JsonPropertyName("amount")]
    public required int Amount { get; init; }

    /// <summary>
    /// Position of the bid in the room's event log.
    /// </summary>
    [JsonPropertyName("seq")]
    public required int Seq { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
