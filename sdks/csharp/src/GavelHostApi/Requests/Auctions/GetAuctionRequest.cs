namespace GavelHostApi.Requests.Auctions;

/// <summary>
/// The inputs of the GetAuction operation.
/// </summary>
public sealed record GetAuctionRequest
{
    /// <summary>
    /// Auction id, or its 6 character join code.
    /// </summary>
    public required string Id { get; init; }
}
