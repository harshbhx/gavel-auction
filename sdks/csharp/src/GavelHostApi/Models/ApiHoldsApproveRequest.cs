using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace GavelHostApi.Models;

public record ApiHoldsApproveRequest
{
    [JsonPropertyName("orderId")]
    [MinLength(1)]
    public required string OrderId { get; init; }

    /// <summary>
    /// Display name. Control characters, invisible direction marks and angle brackets are refused.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("name")]
    [StringLength(64, MinimumLength = 1)]
    public string? Name { get; init; }
}
