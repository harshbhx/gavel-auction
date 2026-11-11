using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.Operator;

/// <summary>
/// The inputs of the OpsVoidAll operation.
/// </summary>
public sealed record OpsVoidAllRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }
}
