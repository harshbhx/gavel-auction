using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.Export;

/// <summary>
/// The inputs of the ExportEvents operation.
/// </summary>
public sealed record ExportEventsRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }
}
