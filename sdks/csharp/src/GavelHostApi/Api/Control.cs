using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using GavelHostApi.Core;
using GavelHostApi.Core.Exceptions;
using GavelHostApi.Core.Models;
using GavelHostApi.Core.Request;
using GavelHostApi.Core.Response;
using GavelHostApi.Errors;
using GavelHostApi.Models;
using GavelHostApi.Requests.Control;

namespace GavelHostApi.Api;

/// <summary>
/// Auctioneer controls and the Stop button.
/// </summary>
public sealed class Control
{
    private readonly RawClient _rawClient;
    private readonly Server _server;
    private readonly AuthSchemes _auth;

    internal Control(RawClient rawClient, Server server, AuthSchemes auth)
    {
        _rawClient = rawClient;
        _server = server;
        _auth = auth;
    }

    /// <summary>
    /// Run an auctioneer control
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ControlResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="ControlAuctionError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Auctioneer token only (a session or screen token authenticates but is refused with 403).
    /// Idempotent by <c>controlId</c>: repeat the same id with the same action and you get the same
    /// answer. A <c>hammer</c> needs <c>args.closeNow: 1</c> while the lot is still open; it is refused
    /// with 409 when the price or leader changed since the console last looked.
    /// </remarks>
    public Task<ControlResponse> ControlAuction(ControlAuctionRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/control"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<ControlResponse>(),
            ControlAuctionError.Response,
            _auth.AuctioneerAuth,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Stop the lot (unsold hammer)
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiAuctionsKillResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="KillAuctionError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Auctioneer token only. Ends the lot as an unsold hammer so settlement voids every hold.
    /// A repeat, or a lot that is already over, is a no-op that answers 200 with the current
    /// state. The body must carry <c>confirm: "STOP"</c>.
    /// </remarks>
    public Task<ApiAuctionsKillResponse> KillAuction(KillAuctionRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/kill"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<ApiAuctionsKillResponse>(),
            KillAuctionError.Response,
            _auth.AuctioneerAuth,
            requestOptions,
            cancellationToken);
}
