using GavelHostApi.Models;

namespace GavelHostApi.Requests.JudgeRooms;

/// <summary>
/// The inputs of the CreateJudgeRoom operation.
/// </summary>
public sealed record CreateJudgeRoomRequest
{
    public ApiJudgeRoomsRequest? Body { get; init; }
}
