using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.Operator;

/// <summary>
/// The inputs of the AdminReplayBundle operation.
/// </summary>
public sealed record AdminReplayBundleRequest
{
    /// <summary>
    /// Id of the auction to bundle.
    /// </summary>
    [RegularExpression("^[0-9A-Za-z_-]{1,64}$")]
    public required string AuctionId { get; init; }
}
