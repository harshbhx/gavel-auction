using GavelHostApi.Models;

namespace GavelHostApi.Requests.JudgeRooms;

/// <summary>
/// The inputs of the PauseJudgeRooms operation.
/// </summary>
public sealed record PauseJudgeRoomsRequest
{
    public required ApiJudgePauseRequest Body { get; init; }
}
