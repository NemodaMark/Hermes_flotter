using Hermes.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics;

namespace Hermes.Api;

public sealed record TenantPermissionRequirement(string Code) : IAuthorizationRequirement;
public sealed class TenantPermissionHandler(ITenantContext tenant) : AuthorizationHandler<TenantPermissionRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, TenantPermissionRequirement requirement)
    {
        if (tenant.TenantId is not null && tenant.UserSubject == context.User.FindFirst("sub")?.Value && tenant.Permissions.Contains(requirement.Code))
            context.Succeed(requirement);
        return Task.CompletedTask;
    }
}

public sealed class ManagementExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is BadHttpRequestException badRequest)
        {
            await Results.Problem(statusCode: badRequest.StatusCode, title: "A kérés formátuma hibás vagy túl nagy.",
                extensions: new Dictionary<string, object?> { ["code"] = "invalid_request" }).ExecuteAsync(context);
            return true;
        }
        if (exception is not ManagementException error) return false;
        await Results.Problem(statusCode: error.StatusCode, title: error.Message, extensions: new Dictionary<string, object?> { ["code"] = error.Code }).ExecuteAsync(context);
        return true;
    }
}
