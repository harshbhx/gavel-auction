using GavelHostApi.Core;
using GavelHostApi.Core.Authentication;
using GavelHostApi.Core.Authentication.ApiKey;
using GavelHostApi.Core.Authentication.Bearer;

namespace GavelHostApi;

internal sealed class AuthSchemes
{
    public IAuthScheme AdminKey { get; }
    public IAuthScheme AuctioneerAuth { get; }
    public IAuthScheme ScreenAuth { get; }
    public IAuthScheme ReviewerAuth { get; }
    public IAuthScheme JudgeKey { get; }
    public IAuthScheme SessionAuth { get; }
    public IAuthScheme ReceiptAuth { get; }

    public AuthSchemes(GavelHostApiClientOptions options)
    {
        AdminKey =
            ApiKeyHeaderScheme.Create(
                "AdminKey",
                "X-Admin-Key",
                options.AdminKeyProvider,
                options.AdminKey ?? EnvironmentVariables.Get("GAVEL_HOST_API_ADMIN_KEY"));
        AuctioneerAuth =
            BearerAuthScheme.Create(
                "AuctioneerAuth",
                options.AuctioneerAuthProvider,
                options.AuctioneerAuth ?? EnvironmentVariables.Get("GAVEL_HOST_API_AUCTIONEER_AUTH"));
        ScreenAuth =
            BearerAuthScheme.Create(
                "ScreenAuth",
                options.ScreenAuthProvider,
                options.ScreenAuth ?? EnvironmentVariables.Get("GAVEL_HOST_API_SCREEN_AUTH"));
        ReviewerAuth =
            BearerAuthScheme.Create(
                "ReviewerAuth",
                options.ReviewerAuthProvider,
                options.ReviewerAuth ?? EnvironmentVariables.Get("GAVEL_HOST_API_REVIEWER_AUTH"));
        JudgeKey =
            ApiKeyHeaderScheme.Create(
                "JudgeKey",
                "X-Judge-Key",
                options.JudgeKeyProvider,
                options.JudgeKey ?? EnvironmentVariables.Get("GAVEL_HOST_API_JUDGE_KEY"));
        SessionAuth =
            BearerAuthScheme.Create(
                "SessionAuth",
                options.SessionAuthProvider,
                options.SessionAuth ?? EnvironmentVariables.Get("GAVEL_HOST_API_SESSION_AUTH"));
        ReceiptAuth =
            BearerAuthScheme.Create(
                "ReceiptAuth",
                options.ReceiptAuthProvider,
                options.ReceiptAuth ?? EnvironmentVariables.Get("GAVEL_HOST_API_RECEIPT_AUTH"));
    }
}
