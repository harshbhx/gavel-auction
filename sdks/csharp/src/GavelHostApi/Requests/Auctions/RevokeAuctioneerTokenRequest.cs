using System.ComponentModel.DataAnnotations;
using GavelHostApi.Models;

namespace GavelHostApi.Requests.Auctions;

/// <summary>
/// The inputs of the RevokeAuctioneerToken operation.
/// </summary>
public sealed record RevokeAuctioneerTokenRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }

    public required ApiAuctionsAuctioneerRevokeRequest Body { get; init; }
}
