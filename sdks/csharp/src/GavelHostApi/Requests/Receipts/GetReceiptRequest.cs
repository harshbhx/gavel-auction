using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.Receipts;

/// <summary>
/// The inputs of the GetReceipt operation.
/// </summary>
public sealed record GetReceiptRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }
}
