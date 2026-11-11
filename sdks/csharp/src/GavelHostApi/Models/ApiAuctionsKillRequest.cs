using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace GavelHostApi.Models;

public record ApiAuctionsKillRequest
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("controlId")]
    [StringLength(64, MinimumLength = 1)]
    public string? ControlId { get; init; }

    [JsonPropertyName("confirm")]
    public string Confirm { get; } = "STOP";
}
