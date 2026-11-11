using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace GavelHostApi.Models;

public record ApiAuctionsJoinRequest
{
    /// <summary>
    /// The invite token from an invite link.
    /// </summary>
    [JsonPropertyName("invite")]
    [StringLength(2048, MinimumLength = 1)]
    public required string Invite { get; init; }
}
