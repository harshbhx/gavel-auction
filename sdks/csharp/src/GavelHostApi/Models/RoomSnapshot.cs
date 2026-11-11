using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation.Attributes;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Models;

/// <summary>
/// Room state for one viewer. Fields not listed here may appear; clients must ignore what they do not know. Private fields (<c>you</c>, <c>yourHold</c>, ceilings) appear only for the bidder they belong to.
/// </summary>
public record RoomSnapshot
{
    /// <summary>
    /// 26 character id (Crockford base 32).
    /// </summary>
    [JsonPropertyName("auctionId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string AuctionId { get; init; }

    /// <summary>
    /// Settings of one auction. Amounts are in cents, durations in milliseconds.
    /// </summary>
    [JsonPropertyName("config")]
    public required AuctionConfig Config { get; init; }

    /// <summary>
    /// Lifecycle state of the auction, from SCHEDULED to DONE.
    /// </summary>
    [JsonPropertyName("status")]
    public required AuctionStatus Status { get; init; }

    /// <summary>
    /// Current price in cents, or null before the first accepted bid.
    /// </summary>
    [JsonPropertyName("price")]
    [Minimum(0)]
    public required int? Price { get; init; }

    /// <summary>
    /// Bidder id of the current leader, or null when there is none.
    /// </summary>
    [JsonPropertyName("leaderId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string? LeaderId { get; init; }

    /// <summary>
    /// Milliseconds since the Unix epoch.
    /// </summary>
    [JsonPropertyName("endTs")]
    public required int EndTs { get; init; }

    /// <summary>
    /// Money in integer US cents. There are no decimals anywhere in the API.
    /// </summary>
    [JsonPropertyName("minNext")]
    [Minimum(0)]
    public required int MinNext { get; init; }

    /// <summary>
    /// True while the auctioneer has paused the lot.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("paused")]
    public bool? Paused { get; init; }

    /// <summary>
    /// Milliseconds left until the lot ends.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("remainingMs")]
    [Minimum(0)]
    public int? RemainingMs { get; init; }

    /// <summary>
    /// True once the auctioneer used the Stop button.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("stopped")]
    public bool? Stopped { get; init; }

    /// <summary>
    /// True once the room no longer takes registrations.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("registrationClosed")]
    public bool? RegistrationClosed { get; init; }

    /// <summary>
    /// Result of the lot, present once it was hammered.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("hammer")]
    public Hammer? Hammer { get; init; }

    /// <summary>
    /// Title of the lot (at most 120 characters). Set by the HTTP snapshot route.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("lotTitle")]
    [MaxLength(120)]
    public string? LotTitle { get; init; }

    /// <summary>
    /// The most one bidder may hold as a limit in this room (the host cap), so a limit picker never offers an amount the host refuses. Absent on older hosts.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("maxCeilingCents")]
    [Minimum(0)]
    public int? MaxCeilingCents { get; init; }

    /// <summary>
    /// Short join code of the auction, 4 to 12 characters (the host mints 6). Set by the HTTP snapshot route.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("joinCode")]
    [StringLength(12, MinimumLength = 4)]
    public string? JoinCode { get; init; }

    /// <summary>
    /// Fundraiser goal, present only when one was set.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("fundraiser")]
    public Fundraiser? Fundraiser { get; init; }

    /// <summary>
    /// Registered bidders, at most 200.
    /// </summary>
    [JsonPropertyName("roster")]
    [MaxLength(200)]
    public required IReadOnlyList<Roster> Roster { get; init; }

    /// <summary>
    /// The most recent audit rows visible to this viewer, at most 50.
    /// </summary>
    [JsonPropertyName("recentAudit")]
    [MaxLength(50)]
    public required IReadOnlyList<object> RecentAudit { get; init; }

    /// <summary>
    /// Settlement progress, present once the lot ended.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("settlement")]
    public Settlement? Settlement { get; init; }

    /// <summary>
    /// The viewing bidder's own ceiling and high bid. Bidder sessions only.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("you")]
    public You1? You { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
