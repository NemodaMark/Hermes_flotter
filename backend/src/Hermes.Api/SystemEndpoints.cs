using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Api;

public static class SystemEndpoints
{
    public static void MapSystemEndpoints(this WebApplication app)
    {
        var system = app.MapGroup("/api/v1/system").RequireAuthorization(SystemPermissions.Manage);
        system.MapGet("/users", async (UserAccounts accounts, HermesDbContext db, CancellationToken ct, int page = 1, string? search = null) =>
        {
            ValidatePage(page);
            if (search?.Length > 100) throw UserAccounts.Error(400, "invalid_search", "A keresés legfeljebb 100 karakter lehet.");
            var query = db.Users.AsNoTracking();
            if (!string.IsNullOrWhiteSpace(search))
            {
                var value = search.Trim().ToUpperInvariant();
                query = query.Where(x => x.NormalizedEmail!.Contains(value) || x.DisplayName.ToUpper().Contains(value) || x.Id == search.Trim());
            }
            var total = await query.CountAsync(ct);
            var users = await query.OrderBy(x => x.NormalizedEmail).ThenBy(x => x.Id).Skip((page - 1) * 25).Take(25).ToArrayAsync(ct);
            var result = new List<UserProfile>();
            foreach (var user in users) result.Add(await accounts.Profile(user, ct));
            return Results.Ok(new PageResult<UserProfile>(result.ToArray(), total, page, 25));
        });
        system.MapGet("/users/{id}", async (string id, UserAccounts accounts, HermesDbContext db, CancellationToken ct) =>
        {
            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct)
                ?? throw UserAccounts.Error(404, "user_not_found", "A felhasználó nem található.");
            return Results.Ok(await accounts.Profile(user, ct));
        });
        system.MapPut("/users/{id}", async (string id, EditUserProfileRequest request, HttpContext context, UserAccounts accounts, CancellationToken ct)
            => Results.Ok(await accounts.Edit(context.User.FindFirst("sub")!.Value, id, request, ct)));
        system.MapPost("/users/{id}/require-password-change", async (string id, UserVersionRequest request, HttpContext context, UserAccounts accounts, CancellationToken ct)
            => Results.Ok(await accounts.ForcePasswordChange(context.User.FindFirst("sub")!.Value, id, request.Version, ct))).RequireRateLimiting("accounts");
        system.MapPut("/users/{id}/system-access", async (string id, ChangeSystemAccessRequest request, HttpContext context, UserAccounts accounts, CancellationToken ct)
            => Results.Ok(await accounts.ChangeSystemAccess(context.User.FindFirst("sub")!.Value, id, request, ct)));
        system.MapGet("/audit-events", async (HermesDbContext db, CancellationToken ct, int page = 1) =>
        {
            ValidatePage(page);
            var query = db.SystemAuditEvents.AsNoTracking();
            return Results.Ok(new PageResult<SystemAuditSummary>(await query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id)
                .Skip((page - 1) * 25).Take(25).Select(x => new SystemAuditSummary(x.Id, x.ActorSubject, x.TargetSubject, x.TenantId, x.Action, x.Details, x.CreatedAt))
                .ToArrayAsync(ct), await query.CountAsync(ct), page, 25));
        });
    }
    private static void ValidatePage(int page)
    {
        if (page is < 1 or > 10000) throw UserAccounts.Error(400, "invalid_page", "Az oldal 1 és 10000 közötti legyen.");
    }
}
