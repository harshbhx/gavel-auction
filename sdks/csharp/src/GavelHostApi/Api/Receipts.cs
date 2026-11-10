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
using GavelHostApi.Requests.Receipts;

namespace GavelHostApi.Api;

/// <summary>
/// Shareable read-only receipts.
/// </summary>
public sealed class Receipts
{
    private readonly RawClient _rawClient;
    private readonly Server _server;
    private readonly AuthSchemes _auth;

    internal Receipts(RawClient rawClient, Server server, AuthSchemes auth)
    {
        _rawClient = rawClient;
        _server = server;
        _auth = auth;
    }

    /// <summary>
    /// Make a shareable receipt link
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiAuctionsReceiptLinkResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="CreateReceiptLinkError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Session token only. Returns a receipt token (valid 4 hours) that opens exactly one
    /// read-only route, <c>GET /api/auctions/{id}/receipt</c>, for this bidder.
    /// </remarks>
    public Task<ApiAuctionsReceiptLinkResponse> CreateReceiptLink(CreateReceiptLinkRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/receipt-link"),
            [new TemplateParam("id", request.Id)],
            [],
            [new HeaderParam("Idempotency-Key", Guid.NewGuid())],
            HttpMethod.Post,
            EmptyBody.Instance,
            JsonResponse.Create<ApiAuctionsReceiptLinkResponse>(),
            CreateReceiptLinkError.Response,
            _auth.SessionAuth,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Read a receipt
    /// </summary>
    /// <param name="request">The operation's inputs</param>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="ApiAuctionsReceiptResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="GetReceiptError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Receipt token only. A cut-down snapshot: the lot, the hammer outcome, the viewer's own
    /// roster row and own hold. The winner keeps a paddle but loses the name, every other
    /// bidder is dropped, and the ceiling, the join code and the audit rows are removed.
    /// </remarks>
    public Task<ApiAuctionsReceiptResponse> GetReceipt(GetReceiptRequest request,
        RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/api/auctions/{id}/receipt"),
            [new TemplateParam("id", request.Id)],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<ApiAuctionsReceiptResponse>(),
            GetReceiptError.Response,
            _auth.ReceiptAuth,
            requestOptions,
            cancellationToken);
}
