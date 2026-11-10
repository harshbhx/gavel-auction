using GavelHostApi.Models;

namespace GavelHostApi.Requests.Auctions;

/// <summary>
/// The inputs of the CreateAuction operation.
/// </summary>
public sealed record CreateAuctionOperationRequest
{
    public required CreateAuctionRequest Body { get; init; }
}
