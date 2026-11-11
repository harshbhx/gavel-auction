using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record CreateAuctionRequest
{
    /// <summary>
    /// Lot title shown to bidders.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("title")]
    [StringLength(120, MinimumLength = 1)]
    public string? Title { get; init; } = "Untitled auction";

    /// <summary>
    /// Settings of one auction. Amounts are in cents, durations in milliseconds.
    /// </summary>
    [JsonPropertyName("config")]
    public required AuctionConfig Config { get; init; }

    /// <summary>
    /// Optional goal; the projector shows a thermometer only when it is set.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("fundraiserGoalCents")]
    [Minimum(1)]
    [Maximum(2147483647)]
    public int? FundraiserGoalCents { get; init; }
}
