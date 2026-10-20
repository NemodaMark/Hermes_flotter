using Hermes.Application;
using Hermes.Domain;

namespace Hermes.Api;

public static class GroupEndpoints
{
    public static void MapGroupEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1").RequireAuthorization().WithMetadata(new TenantRequired());
        var groups = api.MapGroup("/permission-groups");
        groups.MapGet("/", async (IGroupManagement service, CancellationToken ct) => Results.Ok(await service.ListAsync(ct)));
        groups.MapPost("/", async (CreateGroupRequest request, IGroupManagement service, CancellationToken ct) =>
        {
            var group = await service.CreateAsync(request, ct);
            return Results.Created($"/api/v1/permission-groups/{group.Id}", group);
        }).RequireAuthorization(Permissions.GroupsManage);
        groups.MapPut("/{id:guid}", async (Guid id, UpdateGroupRequest request, IGroupManagement service, CancellationToken ct)
            => Results.Ok(await service.UpdateAsync(id, request, ct))).RequireAuthorization(Permissions.GroupsManage);
        groups.MapDelete("/{id:guid}", async (Guid id, long version, IGroupManagement service, CancellationToken ct) =>
        { await service.DeleteAsync(id, version, ct); return Results.NoContent(); }).RequireAuthorization(Permissions.GroupsManage);
        api.MapPut("/members/{userId}/groups", async (string userId, ChangeGroupsRequest request, IGroupManagement service, CancellationToken ct)
            => Results.Ok(await service.AssignAsync(userId, request, ct))).RequireAuthorization(Permissions.Manage);
    }
}
