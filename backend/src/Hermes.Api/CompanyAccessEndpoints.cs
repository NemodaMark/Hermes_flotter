using Hermes.Application;

namespace Hermes.Api;

public static class CompanyAccessEndpoints
{
    public static void MapCompanyAccessEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/company-access").RequireAuthorization();
        static string Actor(HttpContext context) => context.User.FindFirst("sub")!.Value;
        api.MapGet("/companies", async (HttpContext context, ICompanyAccessGroups groups, CancellationToken ct) => Results.Ok(await groups.CompaniesAsync(Actor(context), ct)));
        api.MapGet("/groups", async (HttpContext context, ICompanyAccessGroups groups, CancellationToken ct) => Results.Ok(await groups.ListAsync(Actor(context), ct)));
        api.MapPost("/groups", async (CreateCompanyAccessGroupRequest request, HttpContext context, ICompanyAccessGroups groups, CancellationToken ct) =>
        {
            var result = await groups.CreateAsync(Actor(context), request, ct);
            return Results.Created($"/api/v1/company-access/groups/{result.Id}", result);
        });
        api.MapPut("/groups/{id:guid}", async (Guid id, UpdateCompanyAccessGroupRequest request, HttpContext context, ICompanyAccessGroups groups, CancellationToken ct)
            => Results.Ok(await groups.UpdateAsync(Actor(context), id, request, ct)));
        api.MapDelete("/groups/{id:guid}", async (Guid id, long version, HttpContext context, ICompanyAccessGroups groups, CancellationToken ct) =>
        { await groups.DeleteAsync(Actor(context), id, version, ct); return Results.NoContent(); });
        api.MapGet("/users/{userId}", async (string userId, HttpContext context, ICompanyAccessGroups groups, CancellationToken ct) => Results.Ok(await groups.UserAsync(Actor(context), userId, ct)));
        api.MapPut("/users/{userId}", async (string userId, AssignCompanyAccessGroupsRequest request, HttpContext context, ICompanyAccessGroups groups, CancellationToken ct)
            => Results.Ok(await groups.AssignAsync(Actor(context), userId, request, ct)));
    }
}
