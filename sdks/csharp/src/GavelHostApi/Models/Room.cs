using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record Room
{
    [JsonPropertyName("auctionId")]
    public required string AuctionId { get; init; }

    [JsonPropertyName("seq")]
    public required int Seq { get; init; }

    [JsonPropertyName("status")]
    public required string Status { get; init; }

    [JsonPropertyName("connections")]
    public required int Connections { get; init; }

    [JsonPropertyName("mailboxDepth")]
    public required int MailboxDepth { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
