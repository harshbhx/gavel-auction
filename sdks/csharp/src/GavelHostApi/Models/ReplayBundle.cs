using System.Collections.Generic;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Validation.Attributes;

namespace GavelHostApi.Models;

/// <summary>
/// A verifiable export of the ledger (<c>packages/shared/src/replay-bundle.ts</c>). Hash with <c>verifyPublicExport</c> and compare <c>headHash</c>.
/// </summary>
public record ReplayBundle
{
    /// <summary>
    /// Version of the bundle format.
    /// </summary>
    [JsonPropertyName("version")]
    public required int Version { get; init; }

    /// <summary>
    /// Version of the export rules used to build the bundle.
    /// </summary>
    [JsonPropertyName("exportVersion")]
    public required int ExportVersion { get; init; }

    /// <summary>
    /// Id of the exported auction.
    /// </summary>
    [JsonPropertyName("auctionId")]
    public required string AuctionId { get; init; }

    /// <summary>
    /// Milliseconds since the Unix epoch.
    /// </summary>
    [JsonPropertyName("generatedAt")]
    public required int GeneratedAt { get; init; }

    /// <summary>
    /// Number of events; equals the last event seq.
    /// </summary>
    [JsonPropertyName("count")]
    [Minimum(0)]
    public required int Count { get; init; }

    /// <summary>
    /// Hash of the last public event, or null for an empty ledger.
    /// </summary>
    [JsonPropertyName("headHash")]
    public required string? HeadHash { get; init; }

    /// <summary>
    /// True when the last event closes the auction and names the event before it. False means the bundle is open or not anchored. Always present.
    /// </summary>
    [JsonPropertyName("closed")]
    public required bool Closed { get; init; }

    /// <summary>
    /// The public events in order, one object per event.
    /// </summary>
    [JsonPropertyName("events")]
    public required IReadOnlyList<object> Events { get; init; }

    [JsonExtensionData]
    public AdditionalProperties AdditionalProperties { get; init; } = [];
}
