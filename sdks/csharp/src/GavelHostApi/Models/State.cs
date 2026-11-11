using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Models;

public record State
{
    /// <summary>
    /// Lifecycle state of the auction, from SCHEDULED to DONE.
    /// </summary>
    [JsonPropertyName("status")]
    public required AuctionStatus Status { get; init; }

    [JsonPropertyName("stopped")]
    public required bool Stopped { get; init; }

    [JsonPropertyName("registrationClosed")]
    public required bool RegistrationClosed { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
