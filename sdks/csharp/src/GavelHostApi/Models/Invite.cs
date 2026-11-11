using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record Invite
{
    /// <summary>
    /// 26 character id (Crockford base 32).
    /// </summary>
    [JsonPropertyName("bidderId")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string BidderId { get; init; }

    /// <summary>
    /// Milliseconds since the Unix epoch.
    /// </summary>
    [JsonPropertyName("expiresAt")]
    public required int ExpiresAt { get; init; }

    /// <summary>
    /// Registration link with the invite token in the fragment.
    /// </summary>
    [JsonPropertyName("link")]
    [Format(FormatKind.Uri)]
    public required string Link { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
