using System.ComponentModel.DataAnnotations;
using GavelHostApi.Models;

namespace GavelHostApi.Requests.Control;

/// <summary>
/// The inputs of the KillAuction operation.
/// </summary>
public sealed record KillAuctionRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }

    public required ApiAuctionsKillRequest Body { get; init; }
}
