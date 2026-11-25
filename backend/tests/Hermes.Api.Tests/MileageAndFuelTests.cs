using System.Net;
using System.Net.Http.Json;
using Hermes.Application;
using Hermes.Domain;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    private static DateOnly MileageThisMonth => new(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
    private static string MileageUrl(DateOnly month, string? user = null) => $"/api/v1/mileage/months/{month:yyyy-MM-dd}" + (user is null ? "" : "?userId=" + user);

    [Fact]
    public async Task Mileage_modes_do_not_double_count_and_month_closing_preserves_limit_and_corrections()
    {
        using var owner = await Register(); using var driver = await Register();
        var company = await Company(owner);
        await Join(owner, driver, company.Id, Permissions.MileageRecord);
        var month = MileageThisMonth.AddMonths(-1);
        var url = MileageUrl(month);
        var account = await ScopeOk<MileageUser>(await owner.Client.PutAsJsonAsync($"/api/v1/mileage/accounts/{driver.User.Id}", new MileageAccountInput(1000, 0)));
        var first = await ScopeOk<MileageReport>(await driver.Client.PostAsJsonAsync(url + "/entries", new MileageEntryInput(month, 600, 120)));
        Assert.Equal(600, first.TotalKm); Assert.Equal(120, first.PrivateKm);
        Assert.Equal(month, first.DueMonth);
        var second = await ScopeOk<MileageReport>(await driver.Client.PostAsJsonAsync(url + "/entries", new MileageEntryInput(month.AddDays(1), 500, 80, MonthVersion: first.Version)));
        Assert.Equal(1100, second.TotalKm); Assert.Equal(1000, second.MonthlyLimitKm);
        Assert.Equal(HttpStatusCode.Conflict, (await driver.Client.PutAsJsonAsync(url + "/mode", new MileageModeInput("Monthly", first.Version))).StatusCode);
        var monthly = await ScopeOk<MileageReport>(await driver.Client.PutAsJsonAsync(url + "/mode", new MileageModeInput("Monthly", second.Version)));
        Assert.Equal(1100, monthly.TotalKm);
        var closed = await ScopeOk<MileageReport>(await driver.Client.PutAsJsonAsync(url, new MileageMonthInput(1400, 250, monthly.Version, true)));
        Assert.Equal(1400, closed.TotalKm); Assert.Equal(2, closed.Entries.Length); Assert.NotNull(closed.SubmittedAt);
        Assert.Null(closed.DueMonth); Assert.Equal(1000, closed.MonthlyLimitKm);
        Assert.Equal(HttpStatusCode.Conflict, (await driver.Client.PutAsJsonAsync(url + "/mode", new MileageModeInput("Entries", closed.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await driver.Client.PutAsJsonAsync(url, new MileageMonthInput(1500, 300, closed.Version, true))).StatusCode);
        var accounts = (await owner.Client.GetFromJsonAsync<MileageUser[]>("/api/v1/mileage/accounts"))!;
        var currentAccount = Assert.Single(accounts, x => x.UserId == driver.User.Id);
        (await owner.Client.PutAsJsonAsync($"/api/v1/mileage/accounts/{driver.User.Id}", new MileageAccountInput(2000, currentAccount.Version))).EnsureSuccessStatusCode();
        var fixedMonth = await ScopeOk<MileageReport>(await driver.Client.PutAsJsonAsync(url, new MileageMonthInput(1500, 300, closed.Version, false, Reason: "Elmaradt út hozzáadása")));
        Assert.Equal(month, fixedMonth.DueMonth); Assert.Equal(1000, fixedMonth.MonthlyLimitKm);
        var entries = await ScopeOk<MileageReport>(await driver.Client.PutAsJsonAsync(url + "/mode", new MileageModeInput("Entries", fixedMonth.Version)));
        Assert.Equal(1100, entries.TotalKm); Assert.Equal(200, entries.PrivateKm);
        var reclosed = await ScopeOk<MileageReport>(await driver.Client.PutAsJsonAsync(url, new MileageMonthInput(null, null, entries.Version, true)));
        Assert.Equal(1000, reclosed.MonthlyLimitKm);
        var row = reclosed.Entries[0];
        var correction = await ScopeOk<MileageReport>(await driver.Client.PutAsJsonAsync(url + "/entries/" + row.Id,
            new MileageEntryInput(row.OccurredOn, row.TotalKm, 30, row.Version, reclosed.Version, "Magánút javítása")));
        Assert.Null(correction.SubmittedAt); Assert.Equal(month, correction.DueMonth);
        Assert.Contains(correction.Entries, x => x.UpdatedBy == driver.User.Id && x.Version == 2);
    }

    [Fact]
    public async Task Mileage_access_is_personal_company_bound_and_zero_use_requires_confirmation()
    {
        using var owner = await Register(); using var driver = await Register(); using var colleague = await Register(); using var outsider = await Register();
        var company = await Company(owner); var other = await Company(outsider);
        await Join(owner, driver, company.Id, Permissions.MileageRecord);
        await Join(owner, colleague, company.Id, Permissions.VehiclesRead);
        var month = MileageThisMonth.AddMonths(-1); var url = MileageUrl(month);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.GetAsync(MileageUrl(month, owner.User.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.GetAsync("/api/v1/mileage/accounts")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await colleague.Client.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(MileageUrl(month, outsider.User.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await driver.Client.PutAsJsonAsync(url, new MileageMonthInput(null, null, 0, true))).StatusCode);
        var zero = await ScopeOk<MileageReport>(await driver.Client.PutAsJsonAsync(url, new MileageMonthInput(null, null, 0, true, true)));
        Assert.NotNull(zero.SubmittedAt); Assert.Empty(zero.Entries);
        Select(driver, other.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.GetAsync(url)).StatusCode);
        Select(driver, company.Id);
        Assert.Equal(HttpStatusCode.BadRequest, (await driver.Client.PostAsJsonAsync(url + "/entries", new MileageEntryInput(month.AddMonths(1), 10, 0, MonthVersion: zero.Version, Reason: "Javítás"))).StatusCode);
    }

    [Fact]
    public async Task Current_mileage_report_keeps_self_manager_and_company_boundaries()
    {
        using var owner = await Register(); using var driver = await Register(); using var colleague = await Register(); using var outsider = await Register();
        var company = await Company(owner); var other = await Company(outsider);
        await Join(owner, driver, company.Id, Permissions.MileageRecord);
        await Join(owner, colleague, company.Id, Permissions.VehiclesRead);
        const string url = "/api/v1/mileage/months/current";
        var own = await ScopeOk<MileageReport>(await driver.Client.GetAsync(url));
        Assert.Equal(driver.User.Id, own.UserId);
        Assert.Equal(1, own.Month.Day);
        var entry = new MileageEntryInput(own.Month, 145, 30, MonthVersion: own.Version);
        await ScopeOk<MileageReport>(await driver.Client.PostAsJsonAsync(MileageUrl(own.Month) + "/entries", entry));

        var driverReport = url + "?userId=" + driver.User.Id;
        var managed = await ScopeOk<MileageReport>(await owner.Client.GetAsync(driverReport));
        Assert.Equal(own.Month, managed.Month);
        Assert.Equal(145, managed.TotalKm);
        Assert.Equal(30, managed.PrivateKm);
        Assert.Equal(HttpStatusCode.Forbidden, (await colleague.Client.GetAsync(driverReport)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await colleague.Client.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(url + "?userId=" + outsider.User.Id)).StatusCode);
        Select(driver, other.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Dashboard_mileage_chart_separates_selected_people_and_enforces_mileage_and_company_access()
    {
        using var owner = await Register(); using var first = await Register(); using var second = await Register();
        using var observer = await Register(); using var outsider = await Register();
        var company = await Company(owner);
        await Join(owner, first, company.Id, Permissions.MileageRecord);
        await Join(owner, second, company.Id, Permissions.MileageRecord);
        await Join(owner, observer, company.Id, Permissions.VehiclesRead, Permissions.FleetOverviewRead);
        await Company(outsider);
        var month = MileageThisMonth.AddMonths(-1);
        foreach (var (actor, km) in new[] { (first, 120), (second, 340), (outsider, 999) })
            (await actor.Client.PostAsJsonAsync(MileageUrl(month) + "/entries", new MileageEntryInput(month, km, 10))).EnsureSuccessStatusCode();
        (await first.Client.PostAsJsonAsync(MileageUrl(month.AddMonths(-2)) + "/entries", new MileageEntryInput(month.AddMonths(-2), 800, 20))).EnsureSuccessStatusCode();

        const string url = "/api/v1/dashboard/mileage?months=2";
        var all = await ScopeOk<DashboardMileageChart>(await owner.Client.GetAsync(url));
        Assert.True(all.CanSelectPeople);
        Assert.Contains(all.People, x => x.Id == first.User.Id);
        Assert.DoesNotContain(all.People, x => x.Id == outsider.User.Id);
        Assert.Equal(new DashboardMileagePoint(null, month, 460), Assert.Single(all.Points));
        var selected = await ScopeOk<DashboardMileageChart>(await owner.Client.GetAsync($"{url}&userId={first.User.Id}&userId={second.User.Id}&userId={first.User.Id}"));
        Assert.Equal(2, selected.Points.Length);
        Assert.Contains(new DashboardMileagePoint(first.User.Id, month, 120), selected.Points);
        Assert.Contains(new DashboardMileagePoint(second.User.Id, month, 340), selected.Points);
        var own = await ScopeOk<DashboardMileageChart>(await first.Client.GetAsync(url));
        Assert.False(own.CanSelectPeople);
        Assert.Empty(own.People);
        Assert.Equal(120, Assert.Single(own.Points).Kilometers);
        Assert.Equal(HttpStatusCode.Forbidden, (await first.Client.GetAsync($"{url}&userId={second.User.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await observer.Client.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync($"{url}&userId={outsider.User.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.GetAsync("/api/v1/dashboard/mileage?months=13")).StatusCode);
    }

    [Fact]
    public async Task Mileage_capture_is_atomic_and_same_vehicle_distance_cannot_be_claimed_twice()
    {
        using var owner = await Register(); using var driver = await Register(); using var colleague = await Register();
        var company = await Company(owner);
        var site = await ScopeSite(owner, "MIL-A"); var deniedSite = await ScopeSite(owner, "MIL-B");
        var car = await FleetCar(owner, "MIL-001", site.Id); var denied = await FleetCar(owner, "MIL-002", deniedSite.Id);
        var group = await ScopedGroup(owner, "Használat", company.Id, [site.Id], Permissions.VehiclesRead, Permissions.OdometerCreate, Permissions.FuelManage, Permissions.MileageRecord);
        await CompanyAssign(owner, driver.User.Id, group.Id); Select(driver, company.Id);
        await Join(owner, colleague, company.Id, Permissions.VehiclesRead, Permissions.OdometerCreate, Permissions.FuelManage);
        var month = MileageThisMonth; var day = DateOnly.FromDateTime(DateTime.UtcNow);
        var input = new RecordOdometerRequest(1000, car.Vehicle.Version, new MileageUsageInput(month, 100, 25));
        var saved = await ScopeOk<VehicleSummary>(await driver.Client.PostAsJsonAsync(CarUrl(car) + "/odometer", input));
        var report = (await driver.Client.GetFromJsonAsync<MileageReport>(MileageUrl(month)))!;
        Assert.Equal(100, report.TotalKm); Assert.Equal(25, report.PrivateKm);
        var overlap = new FuelEntryInput(day, 1050, 20, 10000, "HUF", "MIL-1", true, new MileageUsageInput(month, 100, 10));
        Assert.Equal(HttpStatusCode.Conflict, (await driver.Client.PostAsJsonAsync(CarUrl(car) + "/fuel", overlap)).StatusCode);
        var fuel = (await owner.Client.GetFromJsonAsync<FuelMonth>(CarUrl(car) + $"/fuel?month={month:yyyy-MM-dd}"))!;
        Assert.Empty(fuel.Items);
        Assert.Equal(HttpStatusCode.Forbidden, (await colleague.Client.PostAsJsonAsync(CarUrl(car) + "/odometer", input with { Kilometers = 1100, Version = saved.Version, Usage = new(month, 50, 0) })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await driver.Client.PostAsJsonAsync(CarUrl(denied) + "/fuel", overlap)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await driver.Client.PostAsJsonAsync(CarUrl(car) + "/odometer", input with { Kilometers = 1100, Version = saved.Version, Usage = new(month, 40, 50) })).StatusCode);
        var still = (await owner.Client.GetFromJsonAsync<VehicleRecord>(CarUrl(car) + "/details"))!.Vehicle;
        Assert.Equal(1000, still.OdometerKm); Assert.Equal(saved.Version, still.Version);
        var validFuel = overlap with { Usage = new(month, 50, 15) };
        (await driver.Client.PostAsJsonAsync(CarUrl(car) + "/fuel", validFuel)).EnsureSuccessStatusCode();
        report = (await driver.Client.GetFromJsonAsync<MileageReport>(MileageUrl(month)))!;
        Assert.Equal(150, report.TotalKm); Assert.Equal(40, report.PrivateKm);
        var otherCar = await FleetCar(owner, "MIL-003", site.Id);
        (await driver.Client.PostAsJsonAsync(CarUrl(otherCar) + "/odometer", new RecordOdometerRequest(2000, otherCar.Vehicle.Version, new(month, 300, 100)))).EnsureSuccessStatusCode();
        Assert.Equal(450, (await driver.Client.GetFromJsonAsync<MileageReport>(MileageUrl(month)))!.TotalKm);
    }

    [Fact]
    public async Task Fuel_preview_and_save_calculate_personal_mileage_across_vehicles_and_respect_handover_and_scope()
    {
        using var owner = await Register(); using var driver = await Register(); using var colleague = await Register(); using var outsider = await Register();
        var company = await Company(owner); await Company(outsider);
        var site = await ScopeSite(owner, "AUTO-A"); var deniedSite = await ScopeSite(owner, "AUTO-B");
        var first = await FleetCar(owner, "AUTO-001", site.Id); var second = await FleetCar(owner, "AUTO-002", site.Id);
        var denied = await FleetCar(owner, "AUTO-003", deniedSite.Id);
        var group = await ScopedGroup(owner, "Automatikus elszámolás", company.Id, [site.Id], Permissions.FuelManage, Permissions.OdometerCreate, Permissions.MileageRecord);
        await CompanyAssign(owner, driver.User.Id, group.Id); Select(driver, company.Id);
        await Join(owner, colleague, company.Id, Permissions.FuelManage);
        var day = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Europe/Budapest").DateTime);
        var month = new DateOnly(day.Year, day.Month, 1);
        var url = CarUrl(first) + "/fuel";
        string Preview(VehicleRecord car, long kilometers) => CarUrl(car) + $"/fuel/mileage-preview?date={day:yyyy-MM-dd}&kilometers={kilometers}";
        var input = new FuelEntryInput(day, 1120, 25, AutomaticMileage: new(120, 40));

        Assert.Null((await ScopeOk<FuelMileagePreview>(await driver.Client.GetAsync(Preview(first, 1120)))).TotalKm);
        Assert.Equal(HttpStatusCode.NotFound, (await driver.Client.GetAsync(Preview(denied, 1120))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync(Preview(first, 1120))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await colleague.Client.GetAsync(Preview(first, 1120))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await driver.Client.PostAsJsonAsync(url, input)).StatusCode);

        (await owner.Client.PostAsJsonAsync(CarUrl(first) + "/handovers", new HandoverInput(driver.User.Id, 1000, "Rendben", null, first.Vehicle.Version))).EnsureSuccessStatusCode();
        Assert.Equal(120, (await ScopeOk<FuelMileagePreview>(await driver.Client.GetAsync(Preview(first, 1120)))).TotalKm);
        Assert.Equal(HttpStatusCode.BadRequest, (await driver.Client.PostAsJsonAsync(url, input with { AutomaticMileage = new(120, 121) })).StatusCode);
        var saved = await ScopeOk<FuelEntryRow>(await driver.Client.PostAsJsonAsync(url, input));
        Assert.Null(saved.Amount); Assert.Null(saved.Currency); Assert.Null(saved.ReceiptNumber);
        Assert.Equal(HttpStatusCode.Conflict, (await driver.Client.PostAsJsonAsync(url, input)).StatusCode);

        var read = (await owner.Client.GetFromJsonAsync<FuelMonth>(url + $"?month={month:yyyy-MM-dd}"))!;
        Assert.Single(read.Items); Assert.Equal(new FuelTotal(null, 25, null), Assert.Single(read.Totals));
        var secondUrl = CarUrl(second) + "/fuel";
        var legacy = await ScopeOk<FuelEntryRow>(await driver.Client.PostAsJsonAsync(secondUrl, new FuelEntryInput(day, 3000, 20, 130m, "EUR", "OLD-1")));
        Assert.Equal(60, (await ScopeOk<FuelMileagePreview>(await driver.Client.GetAsync(Preview(second, 3060)))).TotalKm);
        (await driver.Client.PostAsJsonAsync(secondUrl, input with { Kilometers = 3060, AutomaticMileage = new(60, 10) })).EnsureSuccessStatusCode();
        var edited = await ScopeOk<FuelEntryRow>(await driver.Client.PutAsJsonAsync(secondUrl + $"/{legacy.Id}",
            new UpdateFuelEntryInput(new(day, 3000, 21), legacy.Version, "Liter javítása")));
        Assert.Equal(130m, edited.Amount); Assert.Equal("EUR", edited.Currency); Assert.Equal("OLD-1", edited.ReceiptNumber);

        var report = (await driver.Client.GetFromJsonAsync<MileageReport>(MileageUrl(month)))!;
        Assert.Equal(180, report.TotalKm); Assert.Equal(50, report.PrivateKm); Assert.Equal(2, report.Entries.Length);
        Assert.Equal(0, (await owner.Client.GetFromJsonAsync<MileageReport>(MileageUrl(month)))!.TotalKm);
        Assert.Equal(HttpStatusCode.Forbidden, (await colleague.Client.GetAsync(MileageUrl(month, driver.User.Id))).StatusCode);

        var current = (await owner.Client.GetFromJsonAsync<VehicleRecord>(CarUrl(first) + "/details"))!.Vehicle;
        (await owner.Client.PutAsJsonAsync(CarUrl(first) + "/assignee", new AssignUserInput(owner.User.Id, current.Version))).EnsureSuccessStatusCode();
        Assert.Null((await ScopeOk<FuelMileagePreview>(await owner.Client.GetAsync(Preview(first, 1200)))).TotalKm);
        Assert.Null((await ScopeOk<FuelMileagePreview>(await driver.Client.GetAsync(Preview(first, 1200)))).TotalKm);
    }

    [Fact]
    public async Task Fuel_corrections_preserve_receipt_audit_and_compute_full_tank_consumption_with_partial_fills()
    {
        using var owner = await Register(); using var driver = await Register(); using var outsider = await Register();
        var company = await Company(owner); await Company(outsider);
        var site = await ScopeSite(owner, "FUE-A"); var otherSite = await ScopeSite(owner, "FUE-B");
        var car = await FleetCar(owner, "FUE-001", site.Id); var denied = await FleetCar(owner, "FUE-002", otherSite.Id);
        var group = await ScopedGroup(owner, "Tankoló", company.Id, [site.Id], Permissions.FuelRead, Permissions.FuelManage);
        await CompanyAssign(owner, driver.User.Id, group.Id); Select(driver, company.Id);
        var month = MileageThisMonth.AddMonths(-1); var url = CarUrl(car) + "/fuel";
        (await driver.Client.PostAsJsonAsync(url, new FuelEntryInput(month.AddDays(-1), 1000, 40, 24000, "HUF", "BASE", true))).EnsureSuccessStatusCode();
        (await driver.Client.PostAsJsonAsync(url, new FuelEntryInput(month.AddDays(1), 1200, 10, 6000, "HUF", "PART"))).EnsureSuccessStatusCode();
        var input = new FuelEntryInput(month.AddDays(3), 1500, 20, 12000, "HUF", "=BAD;\"CSV", true);
        var row = await ScopeOk<FuelEntryRow>(await driver.Client.PostAsync(url, WithPhoto(input)));
        var receipt = await driver.Client.GetByteArrayAsync(url + $"/{row.Id}/receipt");
        var result = (await driver.Client.GetFromJsonAsync<FuelMonth>(url + $"?month={month:yyyy-MM-dd}"))!;
        Assert.Equal(6m, result.LitersPer100Km); Assert.Equal(500, result.MeasuredKilometers); Assert.Equal(2, result.Items.Length);
        Assert.Equal(6m, Assert.Single(result.Items, x => x.Id == row.Id).LitersPer100Km);
        var update = new UpdateFuelEntryInput(input with { Liters = 25, ReceiptNumber = "FIXED-1" }, row.Version, "Liter elírása");
        Assert.Equal(HttpStatusCode.BadRequest, (await driver.Client.PutAsJsonAsync(url + "/" + row.Id, update with { Reason = "" })).StatusCode);
        var changed = await ScopeOk<FuelEntryRow>(await driver.Client.PutAsJsonAsync(url + "/" + row.Id, update));
        Assert.Equal(2, changed.Version); Assert.Equal(driver.User.Id, changed.UpdatedBy); Assert.True(changed.HasReceipt);
        Assert.Equal(receipt, await driver.Client.GetByteArrayAsync(url + $"/{row.Id}/receipt"));
        Assert.Equal(HttpStatusCode.Conflict, (await driver.Client.PutAsJsonAsync(url + "/" + row.Id, update)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await driver.Client.PutAsJsonAsync(CarUrl(denied) + "/fuel/" + row.Id, update)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.PutAsJsonAsync(url + "/" + row.Id, update)).StatusCode);
        result = (await driver.Client.GetFromJsonAsync<FuelMonth>(url + $"?month={month:yyyy-MM-dd}"))!;
        Assert.Equal(7m, result.LitersPer100Km);
        (await driver.Client.PostAsJsonAsync(url + $"/{row.Id}/void", new { reason = "Téves tankolás" })).EnsureSuccessStatusCode();
        Assert.Null((await driver.Client.GetFromJsonAsync<FuelMonth>(url + $"?month={month:yyyy-MM-dd}"))!.LitersPer100Km);
        Assert.Equal(HttpStatusCode.Conflict, (await driver.Client.PutAsJsonAsync(url + "/" + row.Id, update with { Version = 3 })).StatusCode);
    }

    [Fact]
    public async Task Mileage_database_rls_and_origin_guards_block_cross_company_reads_and_source_rewriting()
    {
        using var owner = await Register(); using var outsider = await Register();
        var company = await Company(owner); var other = await Company(outsider);
        var month = MileageThisMonth;
        var report = await ScopeOk<MileageReport>(await owner.Client.PostAsJsonAsync(MileageUrl(month) + "/entries", new MileageEntryInput(month, 100, 10)));
        await using var connection = new NpgsqlConnection(fixture.ApplicationConnection);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var scope = new NpgsqlCommand("SELECT set_config('app.tenant_id', @id, true)", connection, transaction))
        { scope.Parameters.AddWithValue("id", other.Id.ToString()); await scope.ExecuteNonQueryAsync(); }
        await using (var count = new NpgsqlCommand("SELECT count(*) FROM mileage_entries", connection, transaction))
            Assert.Equal(0L, await count.ExecuteScalarAsync());
        await using (var scope = new NpgsqlCommand("SELECT set_config('app.tenant_id', @id, true)", connection, transaction))
        { scope.Parameters.AddWithValue("id", company.Id.ToString()); await scope.ExecuteNonQueryAsync(); }
        await using var tamper = new NpgsqlCommand("UPDATE mileage_entries SET \"Source\"='Fuel', \"Version\"=\"Version\"+1 WHERE \"Id\"=@id", connection, transaction);
        tamper.Parameters.AddWithValue("id", Assert.Single(report.Entries).Id);
        var exception = await Assert.ThrowsAsync<PostgresException>(() => tamper.ExecuteNonQueryAsync());
        Assert.Equal("55000", exception.SqlState);
    }
}

