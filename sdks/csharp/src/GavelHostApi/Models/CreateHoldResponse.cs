using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

public record CreateHoldResponse
{
    /// <summary>
    /// Id of the hold on this host.
    /// </summary>
    [JsonPropertyName("holdId")]
    public required string HoldId { get; init; }

    /// <summary>
    /// PayPal sandbox order id for the hold.
    /// </summary>
    [JsonPropertyName("orderId")]
    public required string OrderId { get; init; }

    /// <summary>
    /// PayPal's own approval page, for when the popup cannot open.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonPropertyName("approveUrl")]
    [Format(FormatKind.Uri)]
    public string? ApproveUrl { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
