using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Models;

public record ApiJudgeRoomsBids409Error
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("accepted")]
    public bool? Accepted { get; init; }

    /// <summary>
    /// Stable code (hold failures, judge, operator and host-level answers, and the 429 of the code lookup and the join route). A plain string; may be a value outside ErrorCode.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("error")]
    public Error4? Error { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("mid")]
    public string? Mid { get; init; }

    /// <summary>
    /// Stable codes. HTTP status per code: 400 bad_message, unsupported_version, not_joined, bad_amount; 401 unauthorized; 403 forbidden, unregistered, ceiling_revoked; 404 not_found; 409 invite_used, closed, already_leading, lot_not_open, unconfirmed, already_bid, auction_paused, conflict, host_fenced; 422 below_increment, over_ceiling, below_reserve, not_higher_than_own_max, limit_exceeded (these arise on the socket, in <c>bid_rejected</c>); 429 rate_limited; 500 internal; 503 room_full, auction_full, room_cap, store_unavailable.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("reason")]
    public ErrorCode? Reason { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("retryable")]
    public bool? Retryable { get; init; }

    /// <summary>
    /// Stable code (core, judge and hold authentication or state failures). Usually one of ErrorCode; judge, hold and lookup codes are listed in ExtraErrorCode and HoldErrorCode, so treat it as a string.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("code")]
    public string? Code { get; init; }

    /// <summary>
    /// Text for a person. Never contains a token or a stack trace.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("message")]
    public string? Message { get; init; }

    /// <summary>
    /// Optional extra text, for example the failing field path and reason.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("detail")]
    public string? Detail { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
