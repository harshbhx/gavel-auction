using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.Auctions;

/// <summary>
/// The inputs of the RevokeAllAuctioneerTokens operation.
/// </summary>
public sealed record RevokeAllAuctioneerTokensRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }
}
