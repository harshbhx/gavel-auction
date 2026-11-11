using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Models;

public record ApiJudgeRoomsBidsResponse2
{
    [JsonPropertyName("accepted")]
    public string Accepted { get; } = "False";

    [JsonPropertyName("error")]
    public string Error { get; } = "bid_rejected";

    [JsonPropertyName("mid")]
    public required string Mid { get; init; }

    /// <summary>
    /// Stable codes. HTTP status per code: 400 bad_message, unsupported_version, not_joined, bad_amount; 401 unauthorized; 403 forbidden, unregistered, ceiling_revoked; 404 not_found; 409 invite_used, closed, already_leading, lot_not_open, unconfirmed, already_bid, auction_paused, conflict, host_fenced; 422 below_increment, over_ceiling, below_reserve, not_higher_than_own_max, limit_exceeded (these arise on the socket, in <c>bid_rejected</c>); 429 rate_limited; 500 internal; 503 room_full, auction_full, room_cap, store_unavailable.
    /// </summary>
    [JsonPropertyName("reason")]
    public required ErrorCode Reason { get; init; }

    [JsonPropertyName("retryable")]
    public required bool Retryable { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
