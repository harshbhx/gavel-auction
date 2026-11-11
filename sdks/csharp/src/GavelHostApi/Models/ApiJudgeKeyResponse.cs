using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ApiJudgeKeyResponse
{
    [JsonPropertyName("ok")]
    public string Ok { get; } = "True";

    /// <summary>
    /// The id of the key (<c>legacy</c> for the shared host key). Never the secret.
    /// </summary>
    [JsonPropertyName("keyId")]
    public required string KeyId { get; init; }

    /// <summary>
    /// Most rooms this key may keep alive at once.
    /// </summary>
    [JsonPropertyName("roomsMax")]
    public required int RoomsMax { get; init; }

    /// <summary>
    /// Rooms of this key alive now.
    /// </summary>
    [JsonPropertyName("roomsLive")]
    public required int RoomsLive { get; init; }

    /// <summary>
    /// When the key stops working. <c>null</c> for a key that never expires (the shared judging key).
    /// </summary>
    [JsonPropertyName("expiresAt")]
    public required DateTimeOffset? ExpiresAt { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
