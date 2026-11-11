using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation.Attributes;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Models;

public record AuctionPublic
{
    /// <summary>
    /// 26 character id (Crockford base 32).
    /// </summary>
    [JsonPropertyName("auctionId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string AuctionId { get; init; }

    /// <summary>
    /// Lot title.
    /// </summary>
    [JsonPropertyName("title")]
    public required string Title { get; init; }

    /// <summary>
    /// Six letters and digits without look-alikes (no 0, O, 1, I, L).
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("joinCode")]
    [RegularExpression("^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$")]
    public string? JoinCode { get; init; }

    /// <summary>
    /// Present and true for a judge room.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("judgeRoom")]
    public bool? JudgeRoom { get; init; }

    /// <summary>
    /// Present and true once the room no longer takes registrations.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("registrationClosed")]
    public bool? RegistrationClosed { get; init; }

    /// <summary>
    /// Present and true once the auctioneer ended the lot.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("stopped")]
    public bool? Stopped { get; init; }

    /// <summary>
    /// Lifecycle state of the auction, from SCHEDULED to DONE.
    /// </summary>
    [JsonPropertyName("status")]
    public required AuctionStatus Status { get; init; }

    /// <summary>
    /// Milliseconds since the Unix epoch.
    /// </summary>
    [JsonPropertyName("endTs")]
    public required int EndTs { get; init; }

    /// <summary>
    /// Number of registered bidders.
    /// </summary>
    [JsonPropertyName("bidderCount")]
    [Minimum(0)]
    public required int BidderCount { get; init; }

    /// <summary>
    /// Current price in cents; absent until the first accepted bid.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("currentCents")]
    [Minimum(0)]
    public int? CurrentCents { get; init; }

    /// <summary>
    /// Paddle number of the current leader; absent when there is none.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("leaderPaddle")]
    [Minimum(1)]
    [Maximum(9999)]
    public int? LeaderPaddle { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
