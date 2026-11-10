using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.Auctions;

/// <summary>
/// The inputs of the RotateAuctioneerToken operation.
/// </summary>
public sealed record RotateAuctioneerTokenRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }
}
