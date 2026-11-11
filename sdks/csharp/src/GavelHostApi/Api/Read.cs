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
using GavelHostApi.Requests.Read;

namespace GavelHostApi.Api;

/// <summary>
/// Snapshot and event log, filtered by the caller's role.
/// </summary>
public sealed class Read
{
    private readonly RawClient _rawClient;
    private readonly Server _server;
    private readonly AuthSchemes _auth;

    internal Read(RawClient rawClient, Server server, AuthSchemes auth)
    {
        _rawClient = rawClient;
        _server = server;
        _auth = auth;
    }

    /// <summary>
    /// Room snapshot for the caller's role
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="StateFrame"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="GetSnapshotError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// The same snapshot the WebSocket sends in a <c>state</c> frame, filtered by role: a bidder
    /// sees only their own ceiling and hold, a screen sees no private fields, the auctioneer
    /// sees the full audit rows. A reviewer token gets the screen's view.
    /// </remarks>
    public Task<StateFrame> GetSnapshot(GetSnapshotRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/snapshot"),
            [new TemplateParam("id", request.Id)],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<StateFrame>(),
            GetSnapshotError.Response,
            AuthScheme.Any(_auth.AuctioneerAuth, _auth.ScreenAuth, _auth.SessionAuth, _auth.ReviewerAuth),
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Page through the event log
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiAuctionsEventsResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="ListEventsError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Auctioneer, screen or reviewer token (a reviewer sees what a screen sees). Events after sequence <c>after</c>, at most <c>limit</c>. A screen
    /// sees full rows only for public event types; every other event is a bare <c>{seq}</c> so the
    /// log stays whole. Ceilings, transcripts, hold references and the auctioneer subject are
    /// never returned. Pass <c>next</c> back as <c>after</c> to continue.
    /// </remarks>
    public Task<ApiAuctionsEventsResponse> ListEvents(ListEventsRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/events"),
            [new TemplateParam("id", request.Id)],
            [new Param("after", request.After), new Param("limit", request.Limit)],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<ApiAuctionsEventsResponse>(),
            ListEventsError.Response,
            AuthScheme.Any(_auth.AuctioneerAuth, _auth.ScreenAuth, _auth.ReviewerAuth),
            requestOptions,
            cancellationToken);
}
