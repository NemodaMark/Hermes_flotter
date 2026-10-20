using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;

namespace Hermes.Api;

public sealed record PasswordChangeAllowed;
public sealed record SystemManageRequirement : IAuthorizationRequirement;

public sealed class SystemManageHandler(HermesDbContext db) : AuthorizationHandler<SystemManageRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, SystemManageRequirement requirement)
    {
        if (context.User.FindFirst("sub")?.Value is { } id && await UserAccounts.IsSystemManager(db, id, CancellationToken.None))
            context.Succeed(requirement);
    }
}

public sealed class PasswordChangeMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, UserManager<ApplicationUser> users)
    {
        if (context.Request.Path.StartsWithSegments("/api") && context.User.Identity?.IsAuthenticated == true
            && context.GetEndpoint()?.Metadata.GetMetadata<PasswordChangeAllowed>() is null
            && await users.GetUserAsync(context.User) is { PasswordChangeRequired: true })
        {
            await Results.Problem(statusCode: 403, title: "A folytatáshoz kötelező megváltoztatnod a jelszavadat.",
                extensions: new Dictionary<string, object?> { ["code"] = "password_change_required" }).ExecuteAsync(context);
            return;
        }
        await next(context);
    }
}
