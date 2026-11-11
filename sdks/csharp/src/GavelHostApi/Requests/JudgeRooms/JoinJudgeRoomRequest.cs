using GavelHostApi.Models;

namespace GavelHostApi.Requests.JudgeRooms;

/// <summary>
/// The inputs of the JoinJudgeRoom operation.
/// </summary>
public sealed record JoinJudgeRoomRequest
{
    public required ApiJudgeJoinRequest Body { get; init; }
}
