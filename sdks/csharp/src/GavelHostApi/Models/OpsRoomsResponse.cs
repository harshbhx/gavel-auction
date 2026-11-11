using System.Collections.Generic;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record OpsRoomsResponse
{
    [JsonPropertyName("rooms")]
    public required IReadOnlyList<Room> Rooms { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
