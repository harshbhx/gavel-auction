using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record ApiJudgeRoomsRequest
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("title")]
    [StringLength(60, MinimumLength = 1)]
    public string? Title { get; init; } = "Sandbox demo lot";

    /// <summary>
    /// Optional goal; the projector shows a thermometer only when it is set.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("fundraiserGoalCents")]
    [Minimum(1)]
    [Maximum(2147483647)]
    public int? FundraiserGoalCents { get; init; }
}
