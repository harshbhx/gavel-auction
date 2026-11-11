using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record ApiJudgeRoomsBidsRequest
{
    /// <summary>
    /// Bid in cents.
    /// </summary>
    [JsonPropertyName("amount")]
    [Minimum(1)]
    [Maximum(2147483647)]
    public required int Amount { get; init; }

    /// <summary>
    /// Optional message id (ULID) that makes a retry safe.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("mid")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public string? Mid { get; init; }
}
