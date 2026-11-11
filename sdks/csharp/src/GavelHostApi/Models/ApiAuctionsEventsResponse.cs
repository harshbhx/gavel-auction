using System.Collections.Generic;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record ApiAuctionsEventsResponse
{
    [JsonPropertyName("events")]
    public required IReadOnlyList<RoomEvent> Events { get; init; }

    [JsonPropertyName("next")]
    [Minimum(0)]
    public required int Next { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
