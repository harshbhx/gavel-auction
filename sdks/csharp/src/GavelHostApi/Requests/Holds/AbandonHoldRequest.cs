using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.Holds;

/// <summary>
/// The inputs of the AbandonHold operation.
/// </summary>
public sealed record AbandonHoldRequest
{
    /// <summary>
    /// Id of the hold, as returned by the create-hold route.
    /// </summary>
    [MinLength(1)]
    public required string HoldId { get; init; }
}
