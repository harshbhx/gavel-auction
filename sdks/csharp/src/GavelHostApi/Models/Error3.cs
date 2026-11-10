using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

/// <summary>
/// The error body. The stable code is in <c>code</c> on the core routes, in <c>error</c> on the operator routes and the host-level answers, and in both on the judge routes; the hold routes use <c>error</c> for hold failures and <c>code</c> for authentication and state failures. Read <c>code ?? error</c>. <c>message</c> is present on the core, hold and judge routes, and absent on the operator routes and host-level answers. 413 and 415 use <c>bad_message</c>. See "Errors" in the description for the table per family.
/// </summary>
public record Error3
{
    /// <summary>
    /// Stable code (hold failures, judge, operator and host-level answers, and the 429 of the code lookup and the join route). A plain string; may be a value outside ErrorCode.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("error")]
    public string? Error { get; init; }

    /// <summary>
    /// Stable code (core, judge and hold authentication or state failures). Usually one of ErrorCode; judge, hold and lookup codes are listed in ExtraErrorCode and HoldErrorCode, so treat it as a string.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("code")]
    public string? Code { get; init; }

    /// <summary>
    /// Text for a person. Never contains a token or a stack trace.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("message")]
    public string? Message { get; init; }

    /// <summary>
    /// Optional extra text, for example the failing field path and reason.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("detail")]
    public string? Detail { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
