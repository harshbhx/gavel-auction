using System;
using System.Collections.Generic;
using GavelHostApi.Core.Authentication;
using GavelHostApi.Core.Configuration;
using GavelHostApi.Core.Hooks;
using GavelHostApi.Servers;

namespace GavelHostApi;

public class GavelHostApiClientOptions
{
    public ServerEnvironment Environment { get; set; } = ServerEnvironment.Default();
    public RetryOptions Retry { get; set; } = RetryOptions.Default();
    public LoggingOptions Logging { get; set; } = new();
    public TimeProvider TimeProvider { get; set; } = TimeProvider.System;
    public ServerOptions Server { get; set; } = new();
    /// <summary>
    /// Maximum time to wait for the next frame of a streaming (SSE) response before the stream is
    /// torn down with a timeout. Bounds only the wait for the server between frames, never the
    /// caller's own processing time. Set to null to wait indefinitely.
    /// </summary>
    public TimeSpan? StreamReadTimeout { get; set; } = TimeSpan.FromSeconds(60);
    public IReadOnlyList<SdkHook> Hooks { get; set; } = [];
    /// <summary>
    /// The operator key, set by the person who runs the host. Compared in constant time. Never put it in a browser or a public repository. No real value appears in this document.
    /// </summary>
    public string? AdminKey { get; set; }
    public CredentialProvider<string>? AdminKeyProvider { get; set; }
    /// <summary>
    /// Auctioneer token (12 hours), carried in the auctioneer link fragment. Bound to one auction. Revoked by rotation.
    /// </summary>
    public string? AuctioneerAuth { get; set; }
    public CredentialProvider<string>? AuctioneerAuthProvider { get; set; }
    /// <summary>
    /// Screen token (12 hours) for the projector page. Read only, no private fields.
    /// </summary>
    public string? ScreenAuth { get; set; }
    public CredentialProvider<string>? ScreenAuthProvider { get; set; }
    /// <summary>
    /// Reviewer token (12 hours), returned by judge-room creation. Read only: the screen's view of the snapshot and event log, and the room ledger. Bound to one judge room.
    /// </summary>
    public string? ReviewerAuth { get; set; }
    public CredentialProvider<string>? ReviewerAuthProvider { get; set; }
    /// <summary>
    /// A limited per-judge key, <c>gvl_judge_&lt;id&gt;_&lt;secret&gt;</c> (set by the host operator, never the operator key). Only the judge-room create and key-check routes read it; it never opens an operator route. It has a room cap and an hourly cap of its own, and an expiry unless it is the shared judging key, which does not expire (sandbox only; the operator can revoke it). No real value appears in this document.
    /// </summary>
    public string? JudgeKey { get; set; }
    public CredentialProvider<string>? JudgeKeyProvider { get; set; }
    /// <summary>
    /// Session (bidder) token (4 hours) returned by the join routes. Names one bidder in one auction.
    /// </summary>
    public string? SessionAuth { get; set; }
    public CredentialProvider<string>? SessionAuthProvider { get; set; }
    /// <summary>
    /// Receipt token (4 hours) returned by the receipt-link route. Opens only GET /api/auctions/{id}/receipt.
    /// </summary>
    public string? ReceiptAuth { get; set; }
    public CredentialProvider<string>? ReceiptAuthProvider { get; set; }
}
