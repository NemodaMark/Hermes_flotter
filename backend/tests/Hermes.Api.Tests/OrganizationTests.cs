using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class OrganizationTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    private sealed record Account(HttpClient Client, string Id, Guid CompanyId) : IDisposable { public void Dispose() => Client.Dispose(); }
    private async Task<Account> Register(bool company = true)
    {
        var client = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(client);
        var id = $"org-{Guid.NewGuid():N}";
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/v1/auth/register", new { userName = id, email = $"{id}@example.test", displayName = "Céges teszt", password = FleetFixture.Password })).StatusCode);
        await FleetFixture.RefreshCsrfAsync(client);
        var tenant = company ? (await (await client.PostAsJsonAsync("/api/v1/tenants", new { name = "Cég és telephely teszt" })).Content.ReadFromJsonAsync<TenantSummary>())!.Id : Guid.Empty;
        if (company) Select(client, tenant);
        return new(client, id, tenant);
    }
    private static void Select(HttpClient client, Guid company) { client.DefaultRequestHeaders.Remove("X-Tenant-Id"); client.DefaultRequestHeaders.Add("X-Tenant-Id", company.ToString()); }
    private static AddressInput Address => new("HU", "1111", "Budapest", "Próba utca 1.", "A épület");
    private static SiteInput SiteData(string code = "BP-01", Guid? contact = null) => new("Budapesti telephely", code, Address, "site@example.test", "+36 1 555 0101", contact);
    private static async Task<T> Ok<T>(HttpResponseMessage response)
    {
        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Created });
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }
    private static Task<CompanyDetails> Profile(Account account) => account.Client.GetFromJsonAsync<CompanyDetails>("/api/v1/company")!;
    private async Task Invite(Account owner, Account member, params string[] permissions)
    {
        var invitation = (await (await owner.Client.PostAsJsonAsync("/api/v1/invitations", new { email = $"{member.Id}@example.test", permissions })).Content.ReadFromJsonAsync<CreatedInvitation>())!;
        Assert.Equal(HttpStatusCode.OK, (await member.Client.PostAsJsonAsync("/api/v1/invitations/accept", invitation.Acceptance)).StatusCode);
        Select(member.Client, owner.CompanyId);
    }

    [Fact]
    public async Task Company_profiles_validate_fields_detect_conflicts_and_keep_before_after_audit()
    {
        using var owner = await Register(); using var other = await Register();
        var initial = await Profile(owner);
        Assert.Equal(owner.Id, initial.CreatedBy); Assert.NotNull(initial.CreatedAt);
        var input = initial.Data with { Name = "Frissített flottacég", LegalName = "Frissített Flottacég Kft.", TaxNumber = "12345678-2-42", RegistrationNumber = "01-09-123456", EuVatNumber = "HU12345678", Address = Address,
            Email = "office@example.test", Phone = "+36 30 123 4567", Website = "https://example.test", Currency = "EUR", DistanceUnit = "mi", TimeZone = "Europe/Vienna" };
        var saved = await Ok<CompanyDetails>(await owner.Client.PutAsJsonAsync("/api/v1/company", input));
        Assert.Equal(input with { Version = input.Version + 1 }, saved.Data);
        Assert.Equal(owner.Id, saved.UpdatedBy); Assert.NotNull(saved.UpdatedAt);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync("/api/v1/company", input)).StatusCode);
        foreach (var invalid in new[] { saved.Data with { Name = "" }, saved.Data with { Email = "invalid" }, saved.Data with { Website = "javascript:alert(1)" }, saved.Data with { TimeZone = "not/a-zone" }, saved.Data with { Address = Address with { CountryCode = "HUN" } }, saved.Data with { Currency = "EURO" }, saved.Data with { DistanceUnit = "invalid" } })
            Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PutAsJsonAsync("/api/v1/company", invalid)).StatusCode);
        Assert.Equal(saved.Data, (await Profile(owner)).Data);
        var entry = Assert.Single((await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/company/audit-events"))!.Items, x => x.Action == "company.updated");
        Assert.Equal(owner.Id, entry.ActorSubject);
        var details = JsonDocument.Parse(entry.Details).RootElement;
        Assert.Equal(initial.Data.Name, details.GetProperty("before").GetProperty("Data").GetProperty("Name").GetString());
        Assert.Equal(input.Name, details.GetProperty("after").GetProperty("Data").GetProperty("Name").GetString());
        Assert.DoesNotContain((await other.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/company/audit-events"))!.Items, x => x.Id == entry.Id);
        owner.Client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PutAsJsonAsync("/api/v1/company", saved.Data)).StatusCode);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
        var central = await db.SystemAuditEvents.SingleAsync(x => x.TenantId == owner.CompanyId && x.Action == "company.updated");
        Assert.Equal(entry.Details, central.Details);
        await Assert.ThrowsAnyAsync<Exception>(() => db.SystemAuditEvents.Where(x => x.Id == central.Id).ExecuteDeleteAsync());
        var tenantContext = new TenantContext(); tenantContext.Set(owner.CompanyId, owner.Id, Permissions.All);
        await using var scoped = FleetFixture.CreateContext(fixture.ApplicationConnection, tenantContext);
        await Assert.ThrowsAnyAsync<Exception>(() => TenantTransaction.RunAsync(scoped, owner.CompanyId,
            async () => await scoped.AccessAuditEvents.Where(x => x.Id == entry.Id).ExecuteDeleteAsync(), default));
    }

    [Fact]
    public async Task Sites_contacts_and_vehicle_assignments_preserve_company_boundaries_and_history()
    {
        using var owner = await Register(); using var other = await Register();
        var contact = await Ok<ContactDetails>(await owner.Client.PostAsJsonAsync("/api/v1/company/contacts", new ContactInput("Kiss Eszter", "Telephelyvezető", "eszter@example.test", "+36 30 1111111")));
        var foreignContact = await Ok<ContactDetails>(await other.Client.PostAsJsonAsync("/api/v1/company/contacts", new ContactInput("Másik cég kapcsolattartója", null, null, null)));
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.PostAsJsonAsync("/api/v1/company/sites", SiteData(contact: foreignContact.Id))).StatusCode);
        var site = await Ok<SiteDetails>(await owner.Client.PostAsJsonAsync("/api/v1/company/sites", SiteData(contact: contact.Id)));
        Assert.Equal(contact.Data.Name, site.ContactName);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync("/api/v1/company/sites", SiteData("bp-01"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await other.Client.PostAsJsonAsync("/api/v1/company/sites", SiteData())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.Client.PutAsJsonAsync($"/api/v1/company/sites/{site.Id}", site.Data with { Code = "NEW", Version = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PatchAsJsonAsync($"/api/v1/company/contacts/{contact.Id}/status", new ChangeArchiveStatus(true, "Próba", contact.Data.Version))).StatusCode);
        var vehicleResponse = await owner.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("ORG-001", "Ford", "Transit"));
        var vehicle = (await vehicleResponse.Content.ReadFromJsonAsync<VehicleSummary>())!;
        Assert.Null(Assert.Single((await owner.Client.GetFromJsonAsync<SiteVehicle[]>("/api/v1/company/vehicles"))!).SiteId);
        var assigned = await Ok<SiteVehicle>(await owner.Client.PutAsJsonAsync($"/api/v1/company/vehicles/{vehicle.Id}/site", new AssignVehicleSite(site.Id, vehicle.Version)));
        Assert.Equal(site.Id, assigned.SiteId);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync($"/api/v1/company/vehicles/{vehicle.Id}/site", new AssignVehicleSite(null, vehicle.Version))).StatusCode);
        Assert.Equal(1, Assert.Single((await owner.Client.GetFromJsonAsync<SiteDetails[]>("/api/v1/company/sites"))!).VehicleCount);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PatchAsJsonAsync($"/api/v1/company/sites/{site.Id}/status", new ChangeArchiveStatus(true, "Bezárás", site.Data.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.Client.PutAsJsonAsync($"/api/v1/company/vehicles/{vehicle.Id}/site", new AssignVehicleSite(null, assigned.Version))).StatusCode);
        var unassigned = await Ok<SiteVehicle>(await owner.Client.PutAsJsonAsync($"/api/v1/company/vehicles/{vehicle.Id}/site", new AssignVehicleSite(null, assigned.Version)));
        Assert.Null(unassigned.SiteId);
        var archived = await Ok<SiteDetails>(await owner.Client.PatchAsJsonAsync($"/api/v1/company/sites/{site.Id}/status", new ChangeArchiveStatus(true, "Bezárás", site.Data.Version)));
        Assert.Empty((await owner.Client.GetFromJsonAsync<SiteDetails[]>("/api/v1/company/sites"))!);
        Assert.True(Assert.Single((await owner.Client.GetFromJsonAsync<SiteDetails[]>("/api/v1/company/sites?includeArchived=true"))!).IsArchived);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync("/api/v1/company/sites", SiteData())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync($"/api/v1/company/vehicles/{vehicle.Id}/site", new AssignVehicleSite(site.Id, unassigned.Version))).StatusCode);
        var archivedContact = await Ok<ContactDetails>(await owner.Client.PatchAsJsonAsync($"/api/v1/company/contacts/{contact.Id}/status", new ChangeArchiveStatus(true, "Ideiglenesen inaktív", contact.Data.Version)));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PatchAsJsonAsync($"/api/v1/company/sites/{site.Id}/status", new ChangeArchiveStatus(false, "Újranyitás", archived.Data.Version))).StatusCode);
        await Ok<ContactDetails>(await owner.Client.PatchAsJsonAsync($"/api/v1/company/contacts/{contact.Id}/status", new ChangeArchiveStatus(false, "Ismét aktív", archivedContact.Data.Version)));
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.PatchAsJsonAsync($"/api/v1/company/sites/{site.Id}/status", new ChangeArchiveStatus(false, "Újranyitás", archived.Data.Version))).StatusCode);
        Assert.Single((await owner.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!);
        var log = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/company/audit-events"))!;
        Assert.Contains(log.Items, x => x.Action == "site.vehicle_assigned");
        Assert.Contains(log.Items, x => x.Action == "site.status_changed");
        var firstAssignment = JsonDocument.Parse(log.Items.Last(x => x.Action == "site.vehicle_assigned").Details).RootElement;
        Assert.Equal(JsonValueKind.Null, firstAssignment.GetProperty("before").GetProperty("SiteName").ValueKind);
        Assert.Equal(site.Data.Name, firstAssignment.GetProperty("after").GetProperty("SiteName").GetString());
    }

    [Fact]
    public async Task Operation_permissions_work_through_groups_without_vehicle_or_company_edit_authority()
    {
        using var owner = await Register(); using var member = await Register(false);
        await Invite(owner, member, Permissions.SitesRead, Permissions.VehiclesRead);
        var companyList = (await member.Client.GetFromJsonAsync<PageResult<CompanyRow>>("/api/v1/companies"))!;
        Assert.Equal(owner.CompanyId, Assert.Single(companyList.Items).Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/company")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PostAsJsonAsync("/api/v1/company/sites", SiteData())).StatusCode);
        var group = await Ok<PermissionGroupSummary>(await owner.Client.PostAsJsonAsync("/api/v1/permission-groups", new CreateGroupRequest("Telephelyre rendelő", [Permissions.SitesAssignVehicles], [owner.CompanyId], false)));
        var membership = (await owner.Client.GetFromJsonAsync<GroupUserSummary>($"/api/v1/permission-groups/users/{member.Id}"))!;
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/users/{member.Id}", new AssignGroupsRequest([group.Id], membership.Version, []))).StatusCode);
        var site = await Ok<SiteDetails>(await owner.Client.PostAsJsonAsync("/api/v1/company/sites", SiteData()));
        var vehicle = (await (await owner.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("PERM-001", "Ford", "Focus"))).Content.ReadFromJsonAsync<VehicleSummary>())!;
        Assert.Equal(HttpStatusCode.OK, (await member.Client.PutAsJsonAsync($"/api/v1/company/vehicles/{vehicle.Id}/site", new AssignVehicleSite(site.Id, vehicle.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PutAsJsonAsync($"/api/v1/vehicles/{vehicle.Id}", new UpdateVehicleRequest("FORGED", "Ford", "Focus", vehicle.Version + 1))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PutAsJsonAsync($"/api/v1/company/sites/{site.Id}", site.Data)).StatusCode);
        // A global list must never reveal another company's name or permissions.
        using var foreign = await Register();
        Assert.DoesNotContain((await member.Client.GetFromJsonAsync<PageResult<CompanyRow>>("/api/v1/companies?status=all"))!.Items, x => x.Id == foreign.CompanyId);
    }

    [Fact]
    public async Task Company_suspension_and_archival_block_operations_but_allow_authorized_recovery_without_data_loss()
    {
        using var owner = await Register(); using var viewer = await Register(false);
        await Invite(owner, viewer, Permissions.VehiclesRead, Permissions.CompaniesRead);
        var vehicle = (await (await owner.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("KEEP-001", "Ford", "Focus"))).Content.ReadFromJsonAsync<VehicleSummary>())!;
        var initial = await Profile(owner);
        var suspended = await Ok<CompanyState>(await owner.Client.PatchAsJsonAsync("/api/v1/company/status", new ChangeCompanyStatus("Suspended", "Átmeneti szünet", initial.Data.Version)));
        Assert.Equal("Suspended", suspended.Status);
        Assert.Empty((await owner.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.Client.GetAsync("/api/v1/vehicles")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.Client.GetAsync("/api/v1/vehicles")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await viewer.Client.GetAsync("/api/v1/company")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.Client.PatchAsJsonAsync("/api/v1/company/status", new ChangeCompanyStatus("Active", "Tiltott", suspended.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync("/api/v1/company/sites", SiteData())).StatusCode);
        Assert.Empty((await owner.Client.GetFromJsonAsync<PageResult<CompanyRow>>("/api/v1/companies"))!.Items);
        Assert.Equal(owner.CompanyId, Assert.Single((await owner.Client.GetFromJsonAsync<PageResult<CompanyRow>>("/api/v1/companies?status=Suspended"))!.Items).Id);
        var archived = await Ok<CompanyState>(await owner.Client.PatchAsJsonAsync("/api/v1/company/status", new ChangeCompanyStatus("Archived", "Cég archiválása", suspended.Version)));
        Assert.Equal("Archived", archived.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PatchAsJsonAsync("/api/v1/company/status", new ChangeCompanyStatus("Active", "Elavult", suspended.Version))).StatusCode);
        var restored = await Ok<CompanyState>(await owner.Client.PatchAsJsonAsync("/api/v1/company/status", new ChangeCompanyStatus("Active", "Újrakezdés", archived.Version)));
        Assert.Equal("Active", restored.Status);
        Assert.Equal("Újrakezdés", restored.Reason); Assert.NotNull(restored.ChangedAt);
        Assert.Equal(vehicle.Id, Assert.Single((await owner.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!).Id);
        Assert.Equal(owner.CompanyId, Assert.Single((await viewer.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!).Id);
        Assert.Equal(3, (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/company/audit-events"))!.Items.Count(x => x.Action == "company.status_changed"));
    }

    [Fact]
    public async Task Database_rls_and_composite_foreign_keys_prevent_unscoped_and_cross_company_access()
    {
        using var owner = await Register(); using var other = await Register();
        var foreign = await Ok<ContactDetails>(await other.Client.PostAsJsonAsync("/api/v1/company/contacts", new ContactInput("Foreign", null, null, null)));
        await using var unscoped = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
        Assert.Empty(await unscoped.CompanyProfiles.IgnoreQueryFilters().ToArrayAsync());
        Assert.Empty(await unscoped.CompanyContacts.IgnoreQueryFilters().ToArrayAsync());
        Assert.Empty(await unscoped.Sites.IgnoreQueryFilters().ToArrayAsync());
        Assert.Empty(await unscoped.VehicleSiteAssignments.IgnoreQueryFilters().ToArrayAsync());
        await using var connection = new NpgsqlConnection(fixture.ApplicationConnection);
        await connection.OpenAsync();
        await using var tx = await connection.BeginTransactionAsync();
        await using (var config = new NpgsqlCommand("SELECT set_config('app.tenant_id', @tenant, true)", connection, tx)) { config.Parameters.AddWithValue("tenant", owner.CompanyId.ToString()); await config.ExecuteNonQueryAsync(); }
        await using var command = new NpgsqlCommand("""
            INSERT INTO company_sites ("TenantId","Id","Name","Code","NormalizedCode","CountryCode","ContactId","IsArchived","Version","CreatedAt","CreatedBy")
            VALUES (@tenant,@id,'Cross tenant','CROSS','CROSS','HU',@contact,false,1,now(),'test')
            """, connection, tx);
        command.Parameters.AddWithValue("tenant", owner.CompanyId); command.Parameters.AddWithValue("id", Guid.NewGuid()); command.Parameters.AddWithValue("contact", foreign.Id);
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, (await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync())).SqlState);
    }

    [Fact]
    public async Task Status_management_does_not_disclose_legal_profile_without_its_read_permission()
    {
        using var owner = await Register(); using var operatorAccount = await Register(false);
        var profile = await Profile(owner);
        await Ok<CompanyDetails>(await owner.Client.PutAsJsonAsync("/api/v1/company", profile.Data with { TaxNumber = "PRIVATE-TAX-NUMBER" }));
        await Invite(owner, operatorAccount, Permissions.CompaniesStatus);
        Assert.Equal(HttpStatusCode.Forbidden, (await operatorAccount.Client.GetAsync("/api/v1/company")).StatusCode);
        var current = (await operatorAccount.Client.GetFromJsonAsync<CompanyState>("/api/v1/company/state"))!;
        var response = await operatorAccount.Client.PatchAsJsonAsync("/api/v1/company/status", new ChangeCompanyStatus("Suspended", "Jogosult szüneteltetés", current.Version));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("PRIVATE-TAX-NUMBER", payload); Assert.DoesNotContain("legalName", payload);
    }

    [Fact]
    public async Task A_company_suspension_blocks_a_vehicle_write_already_waiting_for_its_company_lock()
    {
        using var owner = await Register();
        await using var connection = new NpgsqlConnection(fixture.MigrationConnection);
        await connection.OpenAsync();
        await using var tx = await connection.BeginTransactionAsync();
        int blocker;
        await using (var command = new NpgsqlCommand("SELECT pg_backend_pid()", connection, tx)) blocker = (int)(await command.ExecuteScalarAsync())!;
        await using (var command = new NpgsqlCommand("SELECT * FROM tenants WHERE \"Id\"=@id FOR UPDATE", connection, tx)) { command.Parameters.AddWithValue("id", owner.CompanyId); await command.ExecuteNonQueryAsync(); }
        var write = owner.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("WAIT-001", "Ford", "Focus"));
        var waiting = false;
        for (var attempt = 0; attempt < 150; attempt++)
        {
            await using var query = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND @blocker=ANY(pg_blocking_pids(pid)))", connection, tx);
            query.Parameters.AddWithValue("blocker", blocker);
            if ((bool)(await query.ExecuteScalarAsync())!) { waiting = true; break; }
            await Task.Delay(20);
        }
        Assert.True(waiting, "The vehicle write must have passed middleware and reached the company lock.");
        await using (var command = new NpgsqlCommand("INSERT INTO archived_tenants (\"TenantId\",\"ArchivedAt\",\"Reason\",\"Status\") VALUES (@id,now(),'Concurrent suspension','Suspended')", connection, tx))
        { command.Parameters.AddWithValue("id", owner.CompanyId); await command.ExecuteNonQueryAsync(); }
        await tx.CommitAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await write).StatusCode);
        var tenant = new TenantContext(); tenant.Set(owner.CompanyId, owner.Id, Permissions.All);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, tenant);
        Assert.False(await TenantTransaction.RunAsync(db, owner.CompanyId, () => db.Vehicles.AnyAsync(x => x.Registration == "WAIT-001"), default));
    }
}
