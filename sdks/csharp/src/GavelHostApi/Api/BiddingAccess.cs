using System;
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
using GavelHostApi.Requests.BiddingAccess;

namespace GavelHostApi.Api;

/// <summary>
/// Invites, join and session tokens.
/// </summary>
public sealed class BiddingAccess
{
    private readonly RawClient _rawClient;
    private readonly Server _server;
    private readonly AuthSchemes _auth;

    internal BiddingAccess(RawClient rawClient, Server server, AuthSchemes auth)
    {
        _rawClient = rawClient;
        _server = server;
        _auth = auth;
    }

    /// <summary>
    /// Mint bidder invites
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiAuctionsInvitesResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="CreateInvitesError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Auctioneer token only. Each invite is a single-use link, valid 24 hours, for one new
    /// bidder id. Between 1 and 50 per call.
    /// </remarks>
    public Task<ApiAuctionsInvitesResponse> CreateInvites(CreateInvitesRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/invites"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<ApiAuctionsInvitesResponse>(),
            CreateInvitesError.Response,
            _auth.AuctioneerAuth,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Exchange an invite for a session token
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="JoinResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="JoinAuctionError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// No header credential: the invite token goes in the body. <c>id</c> may be the auction id or
    /// its join code. The invite is burned on use; a second use answers 409 <c>invite_used</c>.
    /// Returns the session token for bidding and the WebSocket address.
    /// </remarks>
    public Task<JoinResponse> JoinAuction(JoinAuctionRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/join"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<JoinResponse>(),
            JoinAuctionError.Response,
            AuthScheme.None,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Re-issue an invite for an existing bidder
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="Invite"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="ReissueInviteError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Auctioneer token only. A bidder who lost their tab gets a fresh single-use invite for
    /// the same bidder id, so their hold and bids stay theirs. Answers 404 for a bidder who
    /// has no hold in the room.
    /// </remarks>
    public Task<Invite> ReissueInvite(ReissueInviteRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/bidders/{bidderId}/invite"),
            [new TemplateParam("id", request.Id), new TemplateParam("bidderId", request.BidderId)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            EmptyBody.Instance,
            JsonResponse.Create<Invite>(),
            ReissueInviteError.Response,
            _auth.AuctioneerAuth,
            requestOptions,
            cancellationToken);
}
