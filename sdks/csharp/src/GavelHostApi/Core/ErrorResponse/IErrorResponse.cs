using System.Threading;
using System.Threading.Tasks;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Core.ErrorResponse;

internal interface IErrorResponse<TError>
{
    Task<TError> Map(ResponseContext context, CancellationToken cancellationToken);
}
