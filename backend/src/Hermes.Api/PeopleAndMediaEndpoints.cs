using System.Globalization;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Http.Features;

namespace Hermes.Api;

public static class PeopleAndMediaEndpoints
{
    public static void MapPeopleAndMediaEndpoints(this WebApplication app)
    {
        var people = app.MapGroup("/api/v1/people").RequireAuthorization();
        static string Actor(HttpContext h) => h.User.FindFirst("sub")!.Value;
        static Guid? Company(HttpContext h) => h.Request.Headers["X-Tenant-Id"].ToString() is { Length: > 0 } raw
            ? Guid.TryParse(raw, out var id) ? id : throw UserAccounts.Error(400, "invalid_company", "Válassz érvényes céget.") : null;
        // Basic colleague profiles are available to every active company member.
        // Global identity, permissions, security settings and unrelated companies stay private.
        people.MapGet("/", async (HttpContext h, PeopleManagement service, CancellationToken ct, int page = 1, string? search = null)
            => Results.Ok(await service.Colleagues(Actor(h), Company(h) ?? throw UserAccounts.Error(400, "company_required", "Válassz céget."), page, search, ct)));
        people.MapGet("/{id}", async (string id, HttpContext h, PeopleManagement service, CancellationToken ct)
            => Results.Ok(await service.Profile(Actor(h), id, Company(h), ct)));
        people.MapPut("/me", async (EditOwnProfile body, HttpContext h, PeopleManagement service, CancellationToken ct)
            => Results.Ok(await service.EditSelf(Actor(h), body, ct)));
        people.MapGet("/{id}/avatar", async (string id, HttpContext h, PeopleManagement service, CancellationToken ct)
            => Image(h, await service.Avatar(Actor(h), id, Company(h), ct)));
        people.MapPost("/{id}/avatar", async (string id, HttpContext h, PeopleManagement service, CancellationToken ct)
            => Results.Ok(await service.UploadAvatar(Actor(h), id, () => ReadImage(h, ct), ct))).RequireRateLimiting("accounts");
        people.MapDelete("/{id}/avatar", async (string id, long version, HttpContext h, PeopleManagement service, CancellationToken ct)
            => Results.Ok(await service.DeleteAvatar(Actor(h), id, version, ct)));
        people.MapGet("/{id}/card-background", async (string id, HttpContext h, PeopleManagement service, CancellationToken ct)
            => Image(h, await service.CardBackground(Actor(h), id, Company(h), ct)));
        people.MapPost("/me/card-background", async (HttpContext h, PeopleManagement service, CancellationToken ct)
            => Results.Ok(await service.UploadCardBackground(Actor(h), () => ReadImage(h, ct), ct))).RequireRateLimiting("accounts");
        people.MapDelete("/me/card-background", async (long version, HttpContext h, PeopleManagement service, CancellationToken ct)
            => Results.Ok(await service.DeleteCardBackground(Actor(h), version, ct)));

        var cars = app.MapGroup("/api/v1/vehicles").RequireAuthorization().WithMetadata(new TenantRequired());
        cars.MapGet("/catalog", async (FleetManagement service, CancellationToken ct) => Results.Ok(await service.Catalog(ct)));
        cars.MapGet("/{id:guid}/photos", async (Guid id, FleetManagement service, CancellationToken ct) => Results.Ok(await service.Photos(id, ct))).RequireAuthorization(Permissions.VehiclesRead);
        cars.MapGet("/{id:guid}/photos/{photo:guid}", async (Guid id, Guid photo, HttpContext h, FleetManagement service, CancellationToken ct)
            => Image(h, await service.Photo(id, photo, ct))).RequireAuthorization(Permissions.VehiclesRead);
        cars.MapPost("/{id:guid}/photos", async (Guid id, HttpContext h, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.UploadPhoto(id, () => ReadImage(h, ct), ct))).RequireRateLimiting("accounts");
        cars.MapDelete("/{id:guid}/photos/{photo:guid}", async (Guid id, Guid photo, long version, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.DeletePhoto(id, photo, version, ct)));
        cars.MapGet("/{id:guid}/assignee", async (Guid id, FleetManagement service, CancellationToken ct)
            => Results.Ok(new { current = await service.Assignee(id, ct) })).RequireAuthorization(Permissions.VehiclesRead);
        cars.MapGet("/{id:guid}/assignee-history", async (Guid id, FleetManagement service, CancellationToken ct, int page = 1)
            => Results.Ok(await service.AssigneeHistory(id, page, ct))).RequireAuthorization(Permissions.VehiclesRead);
        cars.MapGet("/{id:guid}/assignee-options", async (Guid id, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.AssigneeOptions(id, ct))).RequireAuthorization(Permissions.VehiclesAssignUsers);
        cars.MapPut("/{id:guid}/assignee", async (Guid id, AssignUserInput body, FleetManagement service, CancellationToken ct)
            => Results.Ok(new { current = await service.AssignUser(id, body, ct) })).RequireAuthorization(Permissions.VehiclesAssignUsers);
    }

    internal static IResult Image(HttpContext h, byte[] bytes)
    {
        h.Response.Headers.CacheControl = "private, no-store";
        h.Response.Headers["X-Content-Type-Options"] = "nosniff";
        h.Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return Results.File(bytes, "image/jpeg");
    }
    private static async Task<ImageUpload> ReadImage(HttpContext h, CancellationToken ct)
    {
        var request = h.Request;
        if (request.ContentType?.StartsWith("multipart/form-data", StringComparison.OrdinalIgnoreCase) != true)
            throw UserAccounts.Error(400, "image_form", "Egy képfájlt és az adatlap aktuális verzióját küldd el.");
        const int max = ImageProcessing.MaxBytes + 64 * 1024;
        if (request.ContentLength > max) throw UserAccounts.Error(413, "image_size", "Legfeljebb 5 MB-os képet válassz.");
        if (h.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit) limit.MaxRequestBodySize = max;
        IFormCollection form;
        try { form = await request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = max, ValueCountLimit = 4, ValueLengthLimit = 32, KeyLengthLimit = 32 }, ct); }
        catch (Exception ex) when (ex is InvalidDataException or BadHttpRequestException) { throw UserAccounts.Error(400, "image_form", "A kép feltöltése hibás vagy túl nagy."); }
        if (form.Count != 1 || form.Files.Count != 1 || form.Files[0].Name != "file" || form["version"].Count != 1
            || !long.TryParse(form["version"], NumberStyles.None, CultureInfo.InvariantCulture, out var version) || version < 1)
            throw UserAccounts.Error(400, "image_form", "Egy képfájlt és az adatlap aktuális verzióját küldd el.");
        var file = form.Files[0];
        if (file.Length is < 1 or > ImageProcessing.MaxBytes) throw UserAccounts.Error(413, "image_size", "Legfeljebb 5 MB-os képet válassz.");
        await using var input = file.OpenReadStream(); using var output = new MemoryStream(); await input.CopyToAsync(output, ct);
        return new(output.ToArray(), file.FileName, version);
    }
}
