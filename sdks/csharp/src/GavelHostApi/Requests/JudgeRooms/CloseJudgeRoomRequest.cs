using System.ComponentModel.DataAnnotations;

namespace GavelHostApi.Requests.JudgeRooms;

/// <summary>
/// The inputs of the CloseJudgeRoom operation.
/// </summary>
public sealed record CloseJudgeRoomRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }
}
