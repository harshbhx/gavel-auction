using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.Holds;

/// <summary>
/// The inputs of the GetHold operation.
/// </summary>
public sealed record GetHoldRequest
{
    /// <summary>
    /// Id of the hold, as returned by the create-hold route.
    /// </summary>
    [MinLength(1)]
    public required string HoldId { get; init; }
}
