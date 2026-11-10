using System.ComponentModel.DataAnnotations;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Requests.Operator;

/// <summary>
/// The inputs of the AdminExport operation.
/// </summary>
public sealed record AdminExportRequest
{
    /// <summary>
    /// Auction id (<c>auctionId</c> is accepted as an alias).
    /// </summary>
    [RegularExpression("^[0-9A-Za-z_-]{1,64}$")]
    public string? Auction { get; init; }

    /// <summary>
    /// Send <c>1</c> to list every auction id instead of exporting one auction.
    /// </summary>
    public ListEnum? List { get; init; }

    /// <summary>
    /// Which export to return. Without it, <c>auction</c> returns the ledger.
    /// </summary>
    public Kind? Kind { get; init; }
}
