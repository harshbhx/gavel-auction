using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record JudgeRoom
{
    /// <summary>
    /// 26 character id (Crockford base 32).
    /// </summary>
    [JsonPropertyName("auctionId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string AuctionId { get; init; }

    /// <summary>
    /// Six letters and digits without look-alikes (no 0, O, 1, I, L).
    /// </summary>
    [JsonPropertyName("joinCode")]
    [RegularExpression("^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$")]
    public required string JoinCode { get; init; }

    /// <summary>
    /// Title of the lot in the room.
    /// </summary>
    [JsonPropertyName("lotTitle")]
    public required string LotTitle { get; init; }

    /// <summary>
    /// Auctioneer token for this room (12 hours). Send it as a bearer token.
    /// </summary>
    [JsonPropertyName("auctioneerToken")]
    public required string AuctioneerToken { get; init; }

    /// <summary>
    /// Screen token for this room (12 hours). Read only.
    /// </summary>
    [JsonPropertyName("screenToken")]
    public required string ScreenToken { get; init; }

    /// <summary>
    /// Link to the auctioneer console with the token in the URL fragment.
    /// </summary>
    [JsonPropertyName("auctioneerLink")]
    [Format(FormatKind.Uri)]
    public required string AuctioneerLink { get; init; }

    /// <summary>
    /// Link to the projector screen with the token in the URL fragment.
    /// </summary>
    [JsonPropertyName("screenLink")]
    [Format(FormatKind.Uri)]
    public required string ScreenLink { get; init; }

    /// <summary>
    /// Read-only reviewer token for this room (12 hours).
    /// </summary>
    [JsonPropertyName("reviewerToken")]
    public required string ReviewerToken { get; init; }

    /// <summary>
    /// Audit page link with the reviewer token in the fragment.
    /// </summary>
    [JsonPropertyName("reviewerLink")]
    [Format(FormatKind.Uri)]
    public required string ReviewerLink { get; init; }

    /// <summary>
    /// Milliseconds since the Unix epoch.
    /// </summary>
    [JsonPropertyName("expiresAt")]
    public required int ExpiresAt { get; init; }

    /// <summary>
    /// Milliseconds since the Unix epoch.
    /// </summary>
    [JsonPropertyName("biddingEndsAt")]
    public required int BiddingEndsAt { get; init; }

    /// <summary>
    /// Present and true when the room was made with a valid judge key.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("unlocked")]
    public bool? Unlocked { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
