using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.Read;

/// <summary>
/// The inputs of the GetSnapshot operation.
/// </summary>
public sealed record GetSnapshotRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }
}
