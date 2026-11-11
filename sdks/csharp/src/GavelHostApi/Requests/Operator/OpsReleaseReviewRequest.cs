using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.Operator;

/// <summary>
/// The inputs of the OpsReleaseReview operation.
/// </summary>
public sealed record OpsReleaseReviewRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }
}
