using System.Collections.Generic;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Models;

public record OpsSummaryResponse
{
    [JsonPropertyName("logs")]
    public required IReadOnlyList<string> Logs { get; init; }

    [JsonPropertyName("sagas")]
    public required IReadOnlyList<Saga> Sagas { get; init; }

    [JsonPropertyName("paypal")]
    public required IReadOnlyDictionary<string, int> Paypal { get; init; }

    [JsonPropertyName("metrics")]
    public required object Metrics { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
