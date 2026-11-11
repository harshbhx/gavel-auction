using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using GavelHostApi.Core;
using GavelHostApi.Core.Authentication;
using GavelHostApi.Core.ErrorResponse;
using GavelHostApi.Core.Exceptions;
using GavelHostApi.Core.Request;
using GavelHostApi.Core.Response;
using GavelHostApi.Errors;
using GavelHostApi.Models;

namespace GavelHostApi.Api;

/// <summary>
/// Liveness, readiness and build version.
/// </summary>
public sealed class Health
{
    private readonly RawClient _rawClient;
    private readonly Server _server;

    internal Health(RawClient rawClient, Server server)
    {
        _rawClient = rawClient;
        _server = server;
    }

    /// <summary>
    /// Liveness
    /// </summary>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="Status"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="RawError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// Always 200 while the process runs. Never rate limited. Answers on any HTTP method (the host matches the path only); use <c>GET</c>.
    /// </remarks>
    public Task<Status> GetHealth(RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/healthz"),
            [],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<Status>(),
            RawErrorResponse.Instance,
            AuthScheme.None,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Readiness
    /// </summary>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="Status"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="GetReadinessError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// 200 when every migration is applied and the store answers; 503 otherwise. Never rate limited. Answers on any HTTP method (the host matches the path only); use <c>GET</c>.
    /// </remarks>
    public Task<Status> GetReadiness(RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/readyz"),
            [],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<Status>(),
            GetReadinessError.Response,
            AuthScheme.None,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Deployed build
    /// </summary>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="VersionResponse"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="RawError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// The commit the running build was made from, or <c>unknown</c>. Never rate limited. Answers on any HTTP method (the host matches the path only); use <c>GET</c>.
    /// </remarks>
    public Task<VersionResponse> GetVersion(RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/version"),
            [],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<VersionResponse>(),
            RawErrorResponse.Instance,
            AuthScheme.None,
            requestOptions,
            cancellationToken);

    /// <summary>
    /// Warm the host's dependencies
    /// </summary>
    /// <param name="requestOptions">Per-request options, such as an overriding log level for this call</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>A <see cref="Task{TResult}"/> of <see cref="WarmupReport"/> instance.</returns>
    /// <exception cref="ApiException{TError}"> of <see cref="WarmupError"/> when the server returns an error response.</exception>
    /// <remarks>
    /// No credential. Runs the warm-up steps in parallel within a 3 second budget; 200 when all are warm, 503 otherwise.
    /// </remarks>
    public Task<WarmupReport> Warmup(RequestOptions? requestOptions = null,
        CancellationToken cancellationToken = default) =>
        _rawClient.Execute(
            _server.Default("/warmup"),
            [],
            [],
            [],
            HttpMethod.Get,
            EmptyBody.Instance,
            JsonResponse.Create<WarmupReport>(),
            WarmupError.Response,
            AuthScheme.None,
            requestOptions,
            cancellationToken);
}
