using Hermes.Application;
using Hermes.Infrastructure;

namespace Hermes.Api;

public sealed record TenantRequired;

public sealed class TenantResolutionMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, ITenantDirectory directory, TenantContext tenantContext)
    {
        if (context.GetEndpoint()?.Metadata.GetMetadata<TenantRequired>() is null
            || context.User.Identity?.IsAuthenticated != true)
        {
            await next(context);
            return;
        }

        if (!Guid.TryParse(context.Request.Headers["X-Tenant-Id"], out var tenantId))
        {
            await Results.Problem(statusCode: 400, title: "Válassz egy érvényes céget.").ExecuteAsync(context);
            return;
        }

        var subject = context.User.FindFirst("sub")?.Value;
        var membership = subject is null ? null : await directory.FindMembershipAsync(subject, tenantId, context.RequestAborted);
        if (membership is null)
        {
            await Results.Problem(statusCode: 403, title: "Ehhez a céghez nincs hozzáférésed.").ExecuteAsync(context);
            return;
        }

        tenantContext.Set(tenantId, subject!, membership.Permissions.Select(permission => permission.Code));
        await next(context);
    }
}
