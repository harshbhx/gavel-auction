using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record JoinResponse
{
    /// <summary>
    /// Session token for <c>Authorization</c> and for the WebSocket <c>join</c> frame.
    /// </summary>
    [JsonPropertyName("sessionToken")]
    public required string SessionToken { get; init; }

    /// <summary>
    /// 26 character id (Crockford base 32).
    /// </summary>
    [JsonPropertyName("bidderId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string BidderId { get; init; }

    /// <summary>
    /// WebSocket address, <c>wss://&lt;host&gt;/ws</c>.
    /// </summary>
    [JsonPropertyName("wsUrl")]
    [Format(FormatKind.Uri)]
    public required string WsUrl { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
