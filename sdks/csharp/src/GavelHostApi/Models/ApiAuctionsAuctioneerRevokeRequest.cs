using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace GavelHostApi.Models;

public record ApiAuctionsAuctioneerRevokeRequest
{
    /// <summary>
    /// 26 character id (Crockford base 32).
    /// </summary>
    [JsonPropertyName("jti")]
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Jti { get; init; }
}
