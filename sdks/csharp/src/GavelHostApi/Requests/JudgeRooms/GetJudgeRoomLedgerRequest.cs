using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.JudgeRooms;

/// <summary>
/// The inputs of the GetJudgeRoomLedger operation.
/// </summary>
public sealed record GetJudgeRoomLedgerRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }
}
