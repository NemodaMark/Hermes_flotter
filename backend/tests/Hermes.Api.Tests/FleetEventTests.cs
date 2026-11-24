using System.Net;
using System.Net.Http.Json;
using Hermes.Application;
using Hermes.Domain;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    private const string FleetEventsUrl = "/api/v1/vehicles/events";

    private static async Task<FleetEventRow[]> Events(HttpClient client, DateOnly month) =>
        (await ScopeOk<PageResult<FleetEventRow>>(await client.GetAsync($"{FleetEventsUrl}?month={month:yyyy-MM-dd}"))).Items;

    [Fact]
    public async Task Fleet_events_repeat_from_the_original_date_and_edit_and_stop_once_for_the_whole_fleet()
    {
        using var owner = await Register();
        await Company(owner);
        var vehicle = await ScopeCar(owner, "EVT-001");
        var start = new DateOnly(2090, 1, 31);
        var monthly = new FleetEventInput(null, "Kötelező havi elszámolás", start, "Month", 1, new(2090, 3, 31));
        var companyEvent = await ScopeOk<FleetEventRow>(await owner.Client.PostAsJsonAsync(FleetEventsUrl, monthly));
        var oneTime = await ScopeOk<FleetEventRow>(await owner.Client.PostAsJsonAsync(FleetEventsUrl, new FleetEventInput(vehicle.Id, "Szerviz", new(2090, 2, 5))));
        var twoWeeks = await ScopeOk<FleetEventRow>(await owner.Client.PostAsJsonAsync(FleetEventsUrl,
            new FleetEventInput(vehicle.Id, "Ismétlődő ellenőrzés", new(2090, 2, 2), "Week", 2)));
        Assert.Null(companyEvent.VehicleId);
        var february = await Events(owner.Client, new(2090, 2, 1));
        Assert.Equal([twoWeeks.Id, oneTime.Id, companyEvent.Id], february.Select(e => e.Id));
        Assert.Equal([new DateOnly(2090, 2, 2), new DateOnly(2090, 2, 16)], february[0].Occurrences);
        Assert.Equal([new DateOnly(2090, 2, 5)], february[1].Occurrences);
        Assert.Equal([new DateOnly(2090, 2, 28)], february[2].Occurrences);
        Assert.Equal([new DateOnly(2090, 3, 31)], (await Events(owner.Client, new(2090, 3, 1))).Single(e => e.Id == companyEvent.Id).Occurrences);
        Assert.DoesNotContain(await Events(owner.Client, new(2090, 4, 1)), e => e.Id == companyEvent.Id || e.Id == oneTime.Id);

        var eventPath = $"{FleetEventsUrl}/{companyEvent.Id}";
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync(FleetEventsUrl, monthly with { Every = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(eventPath, monthly with { VehicleId = vehicle.Id, Version = companyEvent.Version })).StatusCode);
        var edited = await ScopeOk<FleetEventRow>(await owner.Client.PutAsJsonAsync(eventPath, monthly with { Notes = "Céges havi határidő", Version = companyEvent.Version }));
        Assert.Equal(companyEvent.Version + 1, edited.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync(eventPath + "/stop", new FleetEventStop(companyEvent.Version))).StatusCode);
        (await owner.Client.PostAsJsonAsync(eventPath + "/stop", new FleetEventStop(edited.Version))).EnsureSuccessStatusCode();
        (await owner.Client.PostAsJsonAsync(eventPath + "/stop", new FleetEventStop(edited.Version))).EnsureSuccessStatusCode();
        Assert.DoesNotContain(await Events(owner.Client, new(2090, 3, 1)), e => e.Id == edited.Id);
        var audit = await ScopeOk<PageResult<AuditSummary>>(await owner.Client.GetAsync("/api/v1/audit-events"));
        Assert.Single(audit.Items, a => a.Action == "vehicle.event_stopped");
    }

    [Fact]
    public async Task Fleet_events_keep_company_and_permission_site_boundaries_on_list_targets_changes_and_audit()
    {
        using var owner = await Register(); using var scoped = await Register(); using var foreign = await Register();
        var company = await Company(owner); var other = await Company(foreign);
        var a = await ScopeSite(owner, "EV-A"); var b = await ScopeSite(owner, "EV-B");
        var carA = await ScopeCar(owner, "EV-A1", a.Id); var carB = await ScopeCar(owner, "EV-B1", b.Id);
        var unassigned = await ScopeCar(owner, "EV-N1");
        var read = await ScopedGroup(owner, "Események A", company.Id, [a.Id], Permissions.VehicleEventsRead, Permissions.VehiclesRead, Permissions.AuditRead);
        var manage = await ScopedGroup(owner, "Ütemezés B", company.Id, [b.Id], Permissions.VehicleEventsManage);
        (await CompanyAssign(owner, scoped.User.Id, read.Id, manage.Id)).EnsureSuccessStatusCode();
        Select(scoped, company.Id);
        var date = new DateOnly(2091, 2, 1);
        var forA = new FleetEventInput(carA.Id, "A vizsga", date);
        var forB = forA with { VehicleId = carB.Id, Title = "B vizsga" };
        var aEvent = await ScopeOk<FleetEventRow>(await owner.Client.PostAsJsonAsync(FleetEventsUrl, forA));
        var bEvent = await ScopeOk<FleetEventRow>(await owner.Client.PostAsJsonAsync(FleetEventsUrl, forB));
        var global = await ScopeOk<FleetEventRow>(await owner.Client.PostAsJsonAsync(FleetEventsUrl, forA with { VehicleId = null, Title = "Közös" }));
        (await owner.Client.PostAsJsonAsync(FleetEventsUrl, forA with { VehicleId = unassigned.Id })).EnsureSuccessStatusCode();
        var rows = await Events(scoped.Client, date);
        Assert.Contains(rows, x => x.Id == aEvent.Id && !x.CanManage);
        Assert.Contains(rows, x => x.Id == global.Id && !x.CanManage);
        Assert.DoesNotContain(rows, x => x.Id == bEvent.Id || x.VehicleId == unassigned.Id);
        Assert.Empty(await Events(foreign.Client, date));
        var targets = await ScopeOk<FleetEventOptions>(await scoped.Client.GetAsync(FleetEventsUrl + "/targets"));
        Assert.False(targets.CanScheduleForFleet); Assert.Empty(targets.Vehicles);
        Assert.Equal(HttpStatusCode.NotFound, (await scoped.Client.PostAsJsonAsync(FleetEventsUrl, forA)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await scoped.Client.PostAsJsonAsync(FleetEventsUrl, forB)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await scoped.Client.PostAsJsonAsync(FleetEventsUrl, forA with { VehicleId = null })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await scoped.Client.PutAsJsonAsync($"{FleetEventsUrl}/{bEvent.Id}", forB with { Version = bEvent.Version })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.PostAsJsonAsync($"{FleetEventsUrl}/{aEvent.Id}/stop", new FleetEventStop(aEvent.Version))).StatusCode);
        var audit = await ScopeOk<PageResult<AuditSummary>>(await scoped.Client.GetAsync("/api/v1/audit-events"));
        var eventAudit = Assert.Single(audit.Items, item => item.Action == "vehicle.event_created");
        Assert.Contains(aEvent.Id.ToString(), eventAudit.Details);

        await using var connection = new NpgsqlConnection(fixture.ApplicationConnection);
        await connection.OpenAsync();
        await using var tx = await connection.BeginTransactionAsync();
        await using var scope = new NpgsqlCommand("SELECT set_config('app.tenant_id', @tenant, true)", connection, tx);
        scope.Parameters.AddWithValue("tenant", other.Id.ToString());
        await scope.ExecuteNonQueryAsync();
        await using var count = new NpgsqlCommand("SELECT count(*) FROM fleet_events", connection, tx);
        Assert.Equal(0L, await count.ExecuteScalarAsync());
    }
}
