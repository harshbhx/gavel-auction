using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using GavelHostApi.Models.Enums;

namespace GavelHostApi.Models;

public record ControlRequest
{
    /// <summary>
    /// Idempotency key you mint. The same id with the same action is a repeat.
    /// </summary>
    [JsonPropertyName("controlId")]
    [StringLength(64, MinimumLength = 1)]
    public required string ControlId { get; init; }

    /// <summary>
    /// The control to apply.
    /// </summary>
    [JsonPropertyName("action")]
    public required ActionEnum Action { get; init; }

    /// <summary>
    /// <c>extend</c> needs <c>extraMs</c> (whole number, 1 to 600000). <c>hammer</c> needs <c>closeNow: 1</c> while the lot is open.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("args")]
    public IReadOnlyDictionary<string, double>? Args { get; init; }
}
