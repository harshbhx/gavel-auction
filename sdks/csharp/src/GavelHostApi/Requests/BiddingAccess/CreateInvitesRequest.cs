using System.ComponentModel.DataAnnotations;
using GavelHostApi.Models;

namespace GavelHostApi.Requests.BiddingAccess;

/// <summary>
/// The inputs of the CreateInvites operation.
/// </summary>
public sealed record CreateInvitesRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }

    public ApiAuctionsInvitesRequest? Body { get; init; }
}
