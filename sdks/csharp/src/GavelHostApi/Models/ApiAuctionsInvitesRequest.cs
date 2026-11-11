using System.Text.Json.Serialization;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record ApiAuctionsInvitesRequest
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("count")]
    [Minimum(1)]
    [Maximum(50)]
    public int? Count { get; init; } = 1;
}
