using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record ApiAuctionsReceiptLinkResponse
{
    [JsonPropertyName("token")]
    public required string Token { get; init; }

    [JsonPropertyName("link")]
    [Format(FormatKind.Uri)]
    public required string Link { get; init; }

    /// <summary>
    /// Milliseconds since the Unix epoch.
    /// </summary>
    [JsonPropertyName("expiresAt")]
    public required int ExpiresAt { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
