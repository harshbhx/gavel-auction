using System.ComponentModel.DataAnnotations;
using GavelHostApi.Models;

namespace GavelHostApi.Requests.JudgeRooms;

/// <summary>
/// The inputs of the PlaceJudgeBid operation.
/// </summary>
public sealed record PlaceJudgeBidRequest
{
    /// <summary>
    /// Auction id.
    /// </summary>
    [RegularExpression("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public required string Id { get; init; }

    public required ApiJudgeRoomsBidsRequest Body { get; init; }
}
