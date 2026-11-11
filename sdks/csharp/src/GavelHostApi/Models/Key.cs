using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record Key
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("label")]
    public required string Label { get; init; }

    [JsonPropertyName("maxRooms")]
    public required int MaxRooms { get; init; }

    [JsonPropertyName("perHour")]
    public required int PerHour { get; init; }

    [JsonPropertyName("roomsLive")]
    public required int RoomsLive { get; init; }

    [JsonPropertyName("revoked")]
    public required bool Revoked { get; init; }

    [JsonPropertyName("expired")]
    public required bool Expired { get; init; }

    /// <summary>
    /// When the key stops working. <c>null</c> means it never expires.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("expiresAt")]
    public DateTimeOffset? ExpiresAt { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
