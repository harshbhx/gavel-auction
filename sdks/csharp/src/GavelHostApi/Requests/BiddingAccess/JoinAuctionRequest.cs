using GavelHostApi.Models;

namespace GavelHostApi.Requests.BiddingAccess;

/// <summary>
/// The inputs of the JoinAuction operation.
/// </summary>
public sealed record JoinAuctionRequest
{
    /// <summary>
    /// Auction id, or its 6 character join code.
    /// </summary>
    public required string Id { get; init; }

    public required ApiAuctionsJoinRequest Body { get; init; }
}
