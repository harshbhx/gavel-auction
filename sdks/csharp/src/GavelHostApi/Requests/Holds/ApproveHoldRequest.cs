using System.ComponentModel.DataAnnotations;
using GavelHostApi.Models;

namespace GavelHostApi.Requests.Holds;

/// <summary>
/// The inputs of the ApproveHold operation.
/// </summary>
public sealed record ApproveHoldRequest
{
    /// <summary>
    /// Id of the hold, as returned by the create-hold route.
    /// </summary>
    [MinLength(1)]
    public required string HoldId { get; init; }

    public required ApiHoldsApproveRequest Body { get; init; }
}
