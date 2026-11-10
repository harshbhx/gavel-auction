using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.BiddingAccess;

/// <summary>
/// The inputs of the ReissueInvite operation.
/// </summary>
public sealed record ReissueInviteRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }

    /// <summary>
    /// Id of the registered bidder to re-invite.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string BidderId { get; init; }
}
