using Hermes.Application;

namespace Hermes.Api;

public static class GroupEndpoints
{
    public static void MapGroupEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/permission-groups").RequireAuthorization();
        static string Actor(HttpContext context) => context.User.FindFirst("sub")!.Value;
        api.MapGet("/companies", async (HttpContext context, IGroupManagement groups, CancellationToken ct) => Results.Ok(await groups.CompaniesAsync(Actor(context), ct)));
        api.MapGet("/", async (HttpContext context, IGroupManagement groups, CancellationToken ct) => Results.Ok(await groups.ListAsync(Actor(context), ct)));
        api.MapPost("/", async (CreateGroupRequest request, HttpContext context, IGroupManagement groups, CancellationToken ct) =>
        {
            var result = await groups.CreateAsync(Actor(context), request, ct);
            return Results.Created($"/api/v1/permission-groups/{result.Id}", result);
        });
        api.MapPut("/{id:guid}", async (Guid id, UpdateGroupRequest request, HttpContext context, IGroupManagement groups, CancellationToken ct)
            => Results.Ok(await groups.UpdateAsync(Actor(context), id, request, ct)));
        api.MapDelete("/{id:guid}", async (Guid id, long version, HttpContext context, IGroupManagement groups, CancellationToken ct) =>
        { await groups.DeleteAsync(Actor(context), id, version, ct); return Results.NoContent(); });
        api.MapPut("/{id:guid}/dashboard", async (Guid id, GroupDashboardInput request, HttpContext context, IGroupManagement groups, CancellationToken ct)
            => Results.Ok(await groups.DashboardAsync(Actor(context), id, request, ct)));
        api.MapGet("/users/{userId}", async (string userId, HttpContext context, IGroupManagement groups, CancellationToken ct) => Results.Ok(await groups.UserAsync(Actor(context), userId, ct)));
        api.MapPut("/users/{userId}", async (string userId, AssignGroupsRequest request, HttpContext context, IGroupManagement groups, CancellationToken ct)
            => Results.Ok(await groups.AssignAsync(Actor(context), userId, request, ct)));
    }
}
