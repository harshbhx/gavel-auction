namespace GavelHostApi.Requests.JudgeRooms;

/// <summary>
/// The inputs of the RevokeJudgeKey operation.
/// </summary>
public sealed record RevokeJudgeKeyRequest
{
    /// <summary>
    /// The 8 character id inside the key (<c>gvl_judge_&lt;id&gt;_&lt;secret&gt;</c>), or <c>legacy</c>.
    /// </summary>
    public required string KeyId { get; init; }
}
