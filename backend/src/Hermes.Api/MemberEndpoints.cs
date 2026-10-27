using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;

namespace Hermes.Api;

public static class MemberEndpoints
{
    public static void MapMemberEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1").RequireAuthorization();
        api.MapGet("/permissions", () => Results.Ok(Permissions.Catalog));
        api.MapGet("/tenant/access", async (ITenantContext context, IMemberManagement members, CancellationToken ct)
            => Results.Ok(await members.GetAccessAsync(context.UserSubject!, ct))).WithMetadata(new TenantRequired());

        var group = api.MapGroup("/members").WithMetadata(new TenantRequired());
        group.MapGet("/", async (IMemberManagement members, CancellationToken ct, int page = 1, int pageSize = 25, string? search = null)
            => Results.Ok(await members.ListAsync(page, pageSize, search, ct))).RequireAuthorization(Permissions.MembersRead);
        group.MapGet("/{userId}", async (string userId, IMemberManagement members, CancellationToken ct)
            => Results.Ok(await members.GetAsync(userId, ct))).RequireAuthorization(Permissions.MembersRead);
        group.MapGet("/{userId}/permissions", async (string userId, IMemberManagement members, CancellationToken ct)
            => Results.Ok(await members.GetAccessAsync(userId, ct))).RequireAuthorization(Permissions.Manage);
        group.MapPut("/{userId}/permissions", async (string userId, ChangePermissionsRequest request, IMemberManagement members, CancellationToken ct)
            => Results.Ok(await members.ChangePermissionsAsync(userId, request, ct))).RequireAuthorization(Permissions.Manage);
        group.MapPatch("/{userId}/status", async (string userId, ChangeMemberStatusRequest request, IMemberManagement members, CancellationToken ct)
            => Results.Ok(await members.ChangeStatusAsync(userId, request, ct))).RequireAuthorization(Permissions.MembersUpdate);

        api.MapPost("/invitations/accept", async (AcceptInvitationRequest request, HttpContext context, UserManager<ApplicationUser> users, IMemberManagement members, CancellationToken ct) =>
        {
            var user = await users.GetUserAsync(context.User);
            return user?.NormalizedEmail is null ? Results.Unauthorized() : Results.Ok(await members.AcceptAsync(user.Id, user.NormalizedEmail, request, ct));
        }).RequireRateLimiting("accounts");
        var invitations = api.MapGroup("/invitations").WithMetadata(new TenantRequired()).RequireAuthorization(Permissions.MembersInvite);
        invitations.MapPost("/", async (CreateInvitationRequest request, IMemberManagement members, EmailDelivery mail, CancellationToken ct) =>
        {
            var invitation = await members.InviteAsync(request, ct);
            // InviteAsync has already committed and released the company lock before SMTP starts.
            var link = mail.Link(QueryHelpers.AddQueryString("", new Dictionary<string, string?>
            {
                ["invite"] = "1",
                ["tenantId"] = invitation.Acceptance.TenantId.ToString(),
                ["invitationId"] = invitation.Acceptance.InvitationId.ToString(), ["token"] = invitation.Acceptance.Token
            }).TrimStart('?'));
            var emailDelivery = await mail.TrySend(new(invitation.Invitation.Email, "HERMES – Céges meghívó",
                $"Meghívót kaptál egy HERMES céges munkaterülethez. A meghívott e-mail-címhez tartozó fiókkal tudod elfogadni:\n\n{link}\n\nA hivatkozás 7 napig érvényes, egyszer használható. Ha nem számítottál meghívóra, hagyd figyelmen kívül ezt a levelet."), ct);
            return Results.Created($"/api/v1/invitations/{invitation.Invitation.Id}", new { invitation.Invitation, invitation.Acceptance, emailDelivery });
        });
        invitations.MapGet("/", async (IMemberManagement members, CancellationToken ct, int page = 1, int pageSize = 25)
            => Results.Ok(await members.InvitationsAsync(page, pageSize, ct)));
        invitations.MapDelete("/{id:guid}", async (Guid id, IMemberManagement members, CancellationToken ct) =>
        { await members.RevokeAsync(id, ct); return Results.NoContent(); });
        api.MapGet("/audit-events", async (IMemberManagement members, CancellationToken ct, int page = 1, int pageSize = 25)
            => Results.Ok(await members.AuditAsync(page, pageSize, ct))).WithMetadata(new TenantRequired()).RequireAuthorization(Permissions.AuditRead);
    }
}
