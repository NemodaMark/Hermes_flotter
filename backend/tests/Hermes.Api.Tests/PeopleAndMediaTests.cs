using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using StbImageWriteSharp;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    private static byte[] TestPhoto()
    {
        using var output = new MemoryStream();
        new ImageWriter().WritePng(new byte[] { 40, 120, 90, 255, 200, 170, 110, 255 }, 2, 1, ColorComponents.RedGreenBlueAlpha, output);
        return output.ToArray();
    }
    private static async Task<HttpResponseMessage> SendPhoto(Account actor, string path, long version, byte[]? bytes = null)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(bytes ?? TestPhoto()), "file", "foto.png");
        form.Add(new StringContent(version.ToString(System.Globalization.CultureInfo.InvariantCulture)), "version");
        return await actor.Client.PostAsync(path, form);
    }

    [Fact]
    public async Task Full_vehicle_creation_is_atomic_and_learns_company_scoped_make_model_options()
    {
        using var owner = await Register(); using var foreign = await Register(); await Company(owner); await Company(foreign);
        var input = new CreateVehicleRequest(" NEW-DETAIL ", "ExampleMake", "UniqueModel", Data: new() { BodyType = "Estate", Year = 2020, Color = "Kék", PowerKw = 110, Seats = 5 }, OdometerKm: 25000);
        var created = await ScopeOk<VehicleSummary>(await owner.Client.PostAsJsonAsync("/api/v1/vehicles", input));
        var profile = (await owner.Client.GetFromJsonAsync<VehicleRecord>($"/api/v1/vehicles/{created.Id}/details"))!;
        Assert.Equal("Estate", profile.Data.BodyType); Assert.Equal(2020, profile.Data.Year); Assert.Equal(25000, profile.Vehicle.OdometerKm);
        Assert.Contains((await owner.Client.GetFromJsonAsync<ModelOption[]>("/api/v1/vehicles/catalog"))!, x => x.Make == "ExampleMake" && x.Model == "UniqueModel");
        Assert.Empty((await foreign.Client.GetFromJsonAsync<ModelOption[]>("/api/v1/vehicles/catalog"))!);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync("/api/v1/vehicles", input with { Registration = "BAD-BODY", Data = new() { BodyType = "bad" } })).StatusCode);
        Assert.DoesNotContain((await owner.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!, x => x.Registration == "BAD-BODY");
    }

    [Fact]
    public async Task Vehicle_photos_are_normalized_limited_to_five_versioned_and_isolated()
    {
        using var owner = await Register(); using var foreign = await Register(); await Company(owner); await Company(foreign);
        var car = await ScopeCar(owner, "PHOTOS"); var path = $"/api/v1/vehicles/{car.Id}/photos";
        PhotoCollection result = new([], car.Version);
        for (var i = 0; i < 5; i++) result = await ScopeOk<PhotoCollection>(await SendPhoto(owner, path, result.VehicleVersion));
        Assert.Equal(5, result.Items.Length);
        Assert.Equal(HttpStatusCode.Conflict, (await SendPhoto(owner, path, result.VehicleVersion)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await SendPhoto(owner, path, 1)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(path)).StatusCode);
        var content = await owner.Client.GetAsync(path + "/" + result.Items[0].Id);
        Assert.Equal("image/jpeg", content.Content.Headers.ContentType!.MediaType);
        Assert.Contains("no-store", content.Headers.CacheControl!.ToString());
        Assert.True((await content.Content.ReadAsByteArrayAsync()).AsSpan().StartsWith(new byte[] { 255, 216, 255 }));
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(path + "/" + result.Items[0].Id)).StatusCode);
        result = await ScopeOk<PhotoCollection>(await owner.Client.DeleteAsync(path + $"/{result.Items[0].Id}?version={result.VehicleVersion}"));
        Assert.Equal(4, result.Items.Length);
        result = await ScopeOk<PhotoCollection>(await SendPhoto(owner, path, result.VehicleVersion)); Assert.Equal(5, result.Items.Length);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendPhoto(owner, path, result.VehicleVersion, "<svg>not an image</svg>"u8.ToArray())).StatusCode);
        var audit = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events"))!;
        Assert.Contains(audit.Items, x => x.Action == "vehicle.photo_uploaded"); Assert.Contains(audit.Items, x => x.Action == "vehicle.photo_deleted");
    }

    [Fact]
    public async Task Colleague_profiles_need_shared_active_company_but_never_expose_account_security()
    {
        using var owner = await Register(); using var colleague = await Register(); using var foreign = await Register();
        var company = await Company(owner); await Join(owner, colleague, company.Id); await Company(foreign);
        var people = await colleague.Client.GetFromJsonAsync<PageResult<PersonSummary>>("/api/v1/people");
        Assert.Contains(people!.Items, x => x.Id == owner.User.Id);
        var path = $"/api/v1/people/{owner.User.Id}";
        var profile = await colleague.Client.GetStringAsync(path);
        Assert.DoesNotContain("systemPermissions", profile); Assert.DoesNotContain("passwordChange", profile); Assert.DoesNotContain("companyAccess", profile);
        Assert.Equal(HttpStatusCode.Forbidden, (await colleague.Client.GetAsync($"/api/v1/system/users/{owner.User.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(path)).StatusCode);
        var own = (await owner.Client.GetFromJsonAsync<PersonProfile>(path))!;
        await ScopeOk<PersonSummary>(await SendPhoto(owner, path + "/avatar", own.Version));
        Assert.Equal(HttpStatusCode.OK, (await colleague.Client.GetAsync(path + "/avatar")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(path + "/avatar")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendPhoto(colleague, path + "/avatar", own.Version)).StatusCode);
        var membership = await Access(owner, colleague.User.Id);
        await ScopeOk<TenantAccess>(await owner.Client.PatchAsJsonAsync($"/api/v1/members/{colleague.User.Id}/status", new { isActive = false, membership.Version }));
        Assert.Equal(HttpStatusCode.NotFound, (await colleague.Client.GetAsync(path + "/avatar")).StatusCode);
    }

    [Fact]
    public async Task Assignments_follow_operation_site_scopes_and_profiles_only_show_readable_cars()
    {
        using var owner = await Register(); using var employee = await Register(); using var reader = await Register(); using var foreign = await Register();
        var company = await Company(owner); await Join(owner, employee, company.Id); await Company(foreign);
        var a = await ScopeSite(owner, "ASSIGN-A"); var b = await ScopeSite(owner, "ASSIGN-B");
        var carA = await ScopeCar(owner, "CUSTODY-A", a.Id); var carB = await ScopeCar(owner, "CUSTODY-B", b.Id);
        var assignment = await ScopedGroup(owner, "A hozzárendelő", company.Id, [a.Id], Permissions.VehiclesAssignUsers);
        var readB = await ScopedGroup(owner, "B olvasó", company.Id, [b.Id], Permissions.VehiclesRead);
        await CompanyAssign(owner, reader.User.Id, assignment.Id, readB.Id); Select(reader, company.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await reader.Client.PutAsJsonAsync($"/api/v1/vehicles/{carB.Id}/assignee", new AssignUserInput(employee.User.Id, carB.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PutAsJsonAsync($"/api/v1/vehicles/{carA.Id}/assignee", new AssignUserInput(foreign.User.Id, carA.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await reader.Client.PutAsJsonAsync($"/api/v1/vehicles/{carA.Id}/assignee", new AssignUserInput(employee.User.Id, carA.Version))).StatusCode);
        Assert.Empty((await reader.Client.GetFromJsonAsync<PersonProfile>($"/api/v1/people/{employee.User.Id}"))!.Vehicles);
        Assert.Equal(carA.Id, Assert.Single((await owner.Client.GetFromJsonAsync<PersonProfile>($"/api/v1/people/{employee.User.Id}"))!.Vehicles).Id);
        await ScopeOk<JsonElement>(await owner.Client.PutAsJsonAsync($"/api/v1/vehicles/{carA.Id}/assignee", new AssignUserInput(null, carA.Version + 1)));
        Assert.Empty((await owner.Client.GetFromJsonAsync<PersonProfile>($"/api/v1/people/{employee.User.Id}"))!.Vehicles);
    }

    [Fact]
    public async Task Creation_only_user_can_attach_initial_photos_only_to_their_own_allowed_vehicle()
    {
        using var owner = await Register(); using var creator = await Register();
        var company = await Company(owner); var site = await ScopeSite(owner, "PHOTO-CREATE");
        var group = await ScopedGroup(owner, "Felvétel képekkel", company.Id, [site.Id], Permissions.VehiclesCreate);
        await CompanyAssign(owner, creator.User.Id, group.Id); Select(creator, company.Id);
        var car = await ScopeCar(creator, "MY-NEW-CAR", site.Id);
        Assert.Equal(HttpStatusCode.OK, (await SendPhoto(creator, $"/api/v1/vehicles/{car.Id}/photos", car.Version)).StatusCode);
        var other = await ScopeCar(owner, "OTHER-CREATOR", site.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await SendPhoto(creator, $"/api/v1/vehicles/{other.Id}/photos", other.Version)).StatusCode);
    }

    [Fact]
    public async Task Media_tables_enforce_database_tenant_isolation_and_assignment_history_cannot_be_erased()
    {
        using var owner = await Register(); using var colleague = await Register();
        var company = await Company(owner); await Join(owner, colleague, company.Id);
        var car = await ScopeCar(owner, "DB-MEDIA");
        await ScopeOk<PhotoCollection>(await SendPhoto(owner, $"/api/v1/vehicles/{car.Id}/photos", car.Version));
        await ScopeOk<JsonElement>(await owner.Client.PutAsJsonAsync($"/api/v1/vehicles/{car.Id}/assignee", new AssignUserInput(colleague.User.Id, car.Version + 1)));
        await using var connection = new NpgsqlConnection(fixture.ApplicationConnection); await connection.OpenAsync();
        foreach (var table in new[] { "vehicle_photos", "vehicle_user_assignments", "vehicle_model_options" })
        {
            await using var hidden = new NpgsqlCommand($"SELECT count(*) FROM {table}", connection);
            Assert.Equal(0L, await hidden.ExecuteScalarAsync());
            await using var tx = await connection.BeginTransactionAsync();
            await using var scope = new NpgsqlCommand("SELECT set_config('app.tenant_id', @tenant, true)", connection, tx);
            scope.Parameters.AddWithValue("tenant", company.Id.ToString()); await scope.ExecuteNonQueryAsync();
            await using var visible = new NpgsqlCommand($"SELECT count(*) FROM {table}", connection, tx);
            Assert.Equal(1L, await visible.ExecuteScalarAsync());
            await tx.RollbackAsync();
        }
        await using var historyTx = await connection.BeginTransactionAsync();
        await using var setTenant = new NpgsqlCommand("SELECT set_config('app.tenant_id', @tenant, true)", connection, historyTx);
        setTenant.Parameters.AddWithValue("tenant", company.Id.ToString()); await setTenant.ExecuteNonQueryAsync();
        await using var erase = new NpgsqlCommand("DELETE FROM vehicle_user_assignments", connection, historyTx);
        Assert.Equal("55000", (await Assert.ThrowsAsync<PostgresException>(() => erase.ExecuteNonQueryAsync())).SqlState);
    }

    [Fact]
    public async Task Own_profile_edits_and_avatars_use_revisions_and_reject_corrupt_or_oversized_files()
    {
        using var person = await Register();
        var path = $"/api/v1/people/{person.User.Id}";
        var original = (await person.Client.GetFromJsonAsync<PersonProfile>(path))!;
        var saved = await ScopeOk<PersonSummary>(await person.Client.PutAsJsonAsync("/api/v1/people/me", new EditOwnProfile("Új név", "+36 30 1234567", original.Version)));
        Assert.Equal("Új név", saved.DisplayName);
        Assert.Equal(HttpStatusCode.Conflict, (await SendPhoto(person, path + "/avatar", original.Version)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendPhoto(person, path + "/avatar", original.Version + 1, new byte[] { 255, 216, 255, 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await SendPhoto(person, path + "/avatar", original.Version + 1, new byte[ImageProcessing.MaxBytes + 1])).StatusCode);
        var image = await ScopeOk<PersonSummary>(await SendPhoto(person, path + "/avatar", original.Version + 1)); Assert.NotNull(image.AvatarRevision);
        await ScopeOk<PersonSummary>(await person.Client.DeleteAsync(path + $"/avatar?version={original.Version + 2}"));
        Assert.Equal(HttpStatusCode.NotFound, (await person.Client.GetAsync(path + "/avatar")).StatusCode);
    }

    [Fact]
    public async Task Portrait_card_background_is_optional_versioned_and_only_editable_by_its_owner()
    {
        using var owner = await Register(); using var colleague = await Register(); using var foreign = await Register();
        var company = await Company(owner); await Join(owner, colleague, company.Id); await Company(foreign);
        const string own = "/api/v1/people/me/card-background";
        var profileUrl = $"/api/v1/people/{owner.User.Id}";
        var path = profileUrl + "/card-background";
        var initial = (await owner.Client.GetFromJsonAsync<PersonProfile>(profileUrl))!;
        Assert.Null(initial.Person.CardBackgroundRevision);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendPhoto(owner, own, initial.Version, "<svg/>"u8.ToArray())).StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await SendPhoto(colleague, path, initial.Version)).StatusCode);

        var saved = await ScopeOk<PersonSummary>(await SendPhoto(owner, own, initial.Version));
        Assert.NotNull(saved.CardBackgroundRevision);
        Assert.Null(saved.AvatarRevision);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.DeleteAsync(own + $"?version={initial.Version}")).StatusCode);
        var image = await colleague.Client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, image.StatusCode);
        Assert.Equal("image/jpeg", image.Content.Headers.ContentType?.MediaType);
        Assert.True(image.Headers.CacheControl?.NoStore);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(path)).StatusCode);
        var people = (await colleague.Client.GetFromJsonAsync<PageResult<PersonSummary>>("/api/v1/people"))!;
        var members = (await owner.Client.GetFromJsonAsync<PageResult<MemberSummary>>("/api/v1/members"))!;
        Assert.Equal(saved.CardBackgroundRevision, Assert.Single(people.Items, x => x.Id == owner.User.Id).CardBackgroundRevision);
        Assert.Equal(saved.CardBackgroundRevision, Assert.Single(members.Items, x => x.UserId == owner.User.Id).CardBackgroundRevision);
        using var registrar = await fixture.ClientAsync(null);
        await FleetFixture.SignInAsync(registrar, "test.registrar");
        var system = (await registrar.GetFromJsonAsync<PageResult<UserProfile>>("/api/v1/system/users?search=" + owner.User.Id))!;
        Assert.Equal(saved.CardBackgroundRevision, Assert.Single(system.Items).CardBackgroundRevision);

        var published = (await owner.Client.GetFromJsonAsync<PersonProfile>(profileUrl))!;
        var removed = await ScopeOk<PersonSummary>(await owner.Client.DeleteAsync(own + $"?version={published.Version}"));
        Assert.Null(removed.CardBackgroundRevision);
        Assert.Equal(HttpStatusCode.NotFound, (await colleague.Client.GetAsync(path)).StatusCode);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
        var audit = await db.SystemAuditEvents.Where(x => x.TargetSubject == owner.User.Id).Select(x => x.Action).ToArrayAsync();
        Assert.Contains("user.card_background_changed", audit);
        Assert.Contains("user.card_background_deleted", audit);
    }

    [Fact]
    public async Task Photo_upload_rechecks_site_access_after_reading_the_image_without_holding_a_company_lock()
    {
        using var owner = await Register(); using var member = await Register();
        var company = await Company(owner); var a = await ScopeSite(owner, "PHOTO-A"); var b = await ScopeSite(owner, "PHOTO-B");
        var car = await ScopeCar(owner, "RECHECK-PHOTO", a.Id);
        var group = await ScopedGroup(owner, "Képszerkesztő", company.Id, [a.Id], Permissions.VehiclesUpdate);
        await CompanyAssign(owner, member.User.Id, group.Id);
        var context = new TenantContext(); context.Set(company.Id, member.User.Id, [Permissions.VehiclesUpdate]);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        var error = await Assert.ThrowsAsync<ManagementException>(() => new FleetManagement(db, context).UploadPhoto(car.Id, async () =>
        {
            await ScopeOk<PermissionGroupSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}", new UpdateGroupRequest(group.Name, group.Permissions, [company.Id], group.Version, SiteScopes: [new(company.Id, false, [b.Id])])));
            return new ImageUpload(TestPhoto(), "photo.png", car.Version);
        }, default));
        Assert.Equal(404, error.StatusCode);
        Assert.Empty((await owner.Client.GetFromJsonAsync<PhotoCollection>($"/api/v1/vehicles/{car.Id}/photos"))!.Items);
    }
}
