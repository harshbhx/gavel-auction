using GavelHostApi.Models;

namespace GavelHostApi.Requests.Holds;

/// <summary>
/// The inputs of the CreateHold operation.
/// </summary>
public sealed record CreateHoldRequest
{
    public required ApiHoldsRequest Body { get; init; }
}
