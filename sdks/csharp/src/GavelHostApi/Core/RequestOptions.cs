using System.Collections.Generic;
using Microsoft.Extensions.Logging;
using GavelHostApi.Core.Hooks;
using GavelHostApi.Core.Models;

namespace GavelHostApi.Core;

public sealed record RequestOptions
{
    public LogLevel? LogLevel { get; init; }

    public IReadOnlyList<HeaderParam>? Headers { get; init; }

    public IReadOnlyList<SdkHook>? Hooks { get; init; }
}
