using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using GavelHostApi.Core;
using GavelHostApi.Core.Authentication;
using GavelHostApi.Core.Exceptions;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Request;
using GavelHostApi.Core.Response;
using GavelHostApi.Errors;
using GavelHostApi.Models;
using GavelHostApi.Requests.Export;
using GavelHostApi.Requests.JudgeRooms;
using GavelHostApi.Requests.Operator;

namespace GavelHostApi.Api;

/// <summary>
/// Event log and ledger export.
/// </summary>
public sealed class Export
{
    private readonly RawClient _rawClient;
    private readonly Server _server;
    private readonly AuthSchemes _auth;

    internal Export(RawClient rawClient, Server server, AuthSchemes auth)
    {
        _rawClient = rawClient;
        _server = server;
        _auth = auth;
    }

    /// <summary>
    /// Private ledger and payment state export
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="AdminExportError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only. Output carries every bidder's ceiling, hold reference and bid
    /// transcript: never publish it. Modes by query: <c>auction=&lt;id&gt;</c> (the hash-chained ledger
    /// as NDJSON, last line <c>{head}</c>); <c>list=1</c> (all auction ids); <c>kind=payments&amp;auction=&lt;id&gt;</c>
    /// (settlement journal and holds); <c>kind=payments-global</c> (webhook event ids and kill
    /// switch); <c>kind=roomlog&amp;auction=&lt;id&gt;</c> (room events as NDJSON, last line <c>{end}</c>).
    /// Secret-looking keys are replaced with <c>[redacted]</c> and webhook bodies are dropped.
    /// Errors are <c>{"error": "&lt;code&gt;"}</c>.
    /// </remarks>
    public Task AdminExport(AdminExportRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/admin/export"),
            [],
            [new Param("auction", request.Auction), new Param("list", request.List), new Param("kind", request.Kind)],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            VoidResponse.Instance,
            AdminExportError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Replay bundle of one auction
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ReplayBundle"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="AdminReplayBundleError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only. A self-contained bundle of the auction's ledger for replay and
    /// verification. Query <c>auctionId</c> is required. 404 when the ledger has no entry, 409
    /// <c>ledger_unverified</c> when the hash chain is broken, 500 <c>export_failed</c> when it cannot
    /// be read.
    /// </remarks>
    public Task<ReplayBundle> AdminReplayBundle(AdminReplayBundleRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/admin/replay-bundle"),
            [],
            [new Param("auctionId", request.AuctionId)],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<ReplayBundle>(),
            AdminReplayBundleError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Stream the event log as NDJSON
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="ExportEventsError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Auctioneer token or operator key. One JSON object per line, in sequence order, with
    /// personal fields removed for everyone but the operator. If the store has a gap the
    /// connection is cut instead of ending quietly, so a short file never looks complete.
    /// This route is served by the host directly: its errors are <c>{"error": "&lt;code&gt;"}</c> only.
    /// Only an auctioneer token of that auction or the operator key opens it; any other token
    /// (session, screen, reviewer) is 401, never 403.
    /// </remarks>
    public Task ExportEvents(ExportEventsRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/export"),
            [new TemplateParam("id", request.Id)],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            VoidResponse.Instance,
            ExportEventsError.Response,
            AuthScheme.Any(_auth.AuctioneerAuth, _auth.AdminKey),
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Verifiable ledger of a judge room
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ReplayBundle"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="GetJudgeRoomLedgerError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Reviewer or auctioneer token of that room. The room's hash-chained ledger as a replay
    /// bundle with the private fields removed. The private chain and the public chain are
    /// both checked before anything is sent: a broken chain answers 409 <c>ledger_unverified</c>
    /// instead of a bundle that looks fine. 404 before the ledger has any entry, for an id
    /// that is not a judge room, or when judge rooms are off.
    /// </remarks>
    public Task<ReplayBundle> GetJudgeRoomLedger(GetJudgeRoomLedgerRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/judge/rooms/{id}/ledger"),
            [new TemplateParam("id", request.Id)],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<ReplayBundle>(),
            GetJudgeRoomLedgerError.Response,
            AuthScheme.Any(_auth.ReviewerAuth, _auth.AuctioneerAuth),
            requestOptions,
            cancellationToken);
}
