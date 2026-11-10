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
using GavelHostApi.Requests.Auctions;

namespace GavelHostApi.Api;

/// <summary>
/// Create an auction and read its public facts.
/// </summary>
public sealed class Auctions
{
    private readonly RawClient _rawClient;
    private readonly Server _server;
    private readonly AuthSchemes _auth;

    internal Auctions(RawClient rawClient, Server server, AuthSchemes auth)
    {
        _rawClient = rawClient;
        _server = server;
        _auth = auth;
    }

    /// <summary>
    /// Create an auction
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="CreateAuctionResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="CreateAuctionError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only. Creates the auction, reserves a 6 character join code, and returns links
    /// for the auctioneer console and the projector screen. The tokens are inside the links
    /// (fragment <c>#token=</c>), valid 12 hours.
    /// <para>
    /// End time rules: <c>config.endTs</c> must be strictly after the host's clock and at most 24
    /// hours ahead (400 <c>bad_message</c>, "end time is more than a day away", otherwise). The
    /// host runs a flat English lot with one hold per event: <c>mode</c> other than <c>english</c>,
    /// <c>holdScope: lot</c> and an <c>incrementLadder</c> are refused with 400 <c>bad_message</c>
    /// ("unsupported mode, increment ladder or hold scope"). Answers 503 <c>room_cap</c> when the
    /// host holds the most auctions it allows.
    /// </para>
    /// </remarks>
    public Task<CreateAuctionResponse> CreateAuction(CreateAuctionOperationRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions"),
            [],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<CreateAuctionResponse>(),
            CreateAuctionError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Public facts of an auction
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="AuctionPublic"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="GetAuctionError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// No credential. <c>id</c> is the auction id or its join code (any case; spaces, dashes and a
    /// <c>GVL-</c> prefix are ignored). Looking up by code is guess-protected: after 5 wrong codes
    /// a source address is locked out for 15 minutes (429 <c>code_locked</c>).
    /// </remarks>
    public Task<AuctionPublic> GetAuction(GetAuctionRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}"),
            [new TemplateParam("id", request.Id)],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<AuctionPublic>(),
            GetAuctionError.Response,
            AuthScheme.None,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Revoke every auctioneer token
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="Revoked"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="RevokeAllAuctioneerTokensError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only. Kills every auctioneer token of the auction and issues no new one.
    /// </remarks>
    public Task<Revoked> RevokeAllAuctioneerTokens(RevokeAllAuctioneerTokensRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/auctioneer/revoke-all"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            EmptyBody.Instance,
            JsonResponse.Create<Revoked>(),
            RevokeAllAuctioneerTokensError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Revoke one auctioneer token by jti
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="Revoked"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="RevokeAuctioneerTokenError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only. For a lost or leaked link when you know its token id.
    /// </remarks>
    public Task<Revoked> RevokeAuctioneerToken(RevokeAuctioneerTokenRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/auctioneer/revoke"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            JsonRequest.Create(request.Body),
            JsonResponse.Create<Revoked>(),
            RevokeAuctioneerTokenError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Rotate the auctioneer link
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiAuctionsAuctioneerRotateResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="RotateAuctioneerTokenError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Operator only. Kills every auctioneer token issued before now and returns a fresh link.
    /// A leaked auctioneer link cannot do this, by design.
    /// </remarks>
    public Task<ApiAuctionsAuctioneerRotateResponse> RotateAuctioneerToken(RotateAuctioneerTokenRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/auctioneer/rotate"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            EmptyBody.Instance,
            JsonResponse.Create<ApiAuctionsAuctioneerRotateResponse>(),
            RotateAuctioneerTokenError.Response,
            _auth.AdminKey,
            requestOptions,
            cancellationToken);
}
