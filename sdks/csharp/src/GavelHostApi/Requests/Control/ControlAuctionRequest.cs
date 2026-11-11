using System.ComponentModel.DataAnnotations;
using GavelHostApi.Models;

namespace GavelHostApi.Requests.Control;

/// <summary>
/// The inputs of the ControlAuction operation.
/// </summary>
public sealed record ControlAuctionRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }

    public required ControlRequest Body { get; init; }
}
