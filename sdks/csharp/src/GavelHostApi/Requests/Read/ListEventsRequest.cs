using System.ComponentModel.DataAnnotations;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Requests.Read;

/// <summary>
/// The inputs of the ListEvents operation.
/// </summary>
public sealed record ListEventsRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }

    /// <summary>
    /// Return events after this sequence number. Pass the <c>next</c> of the previous page to continue.
    /// </summary>
    [Minimum(0)]
    public int After { get; init; } = 0;

    /// <summary>
    /// Most events to return in one page.
    /// </summary>
    [Minimum(1)]
    [Maximum(1000)]
    public int Limit { get; init; } = 100;
}
