using System.Collections.Generic;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record ApiAuctionsInvitesResponse
{
    [JsonPropertyName("invites")]
    public required IReadOnlyList<Invite> Invites { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
