using System.Net;
using System.Net.Http.Json;
using System.IO.Compression;
using System.Security;
using System.Text;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class FuelSettlementCalculatorTests
{
    [Theory]
    [InlineData(350, 0, 0, 0)]
    [InlineData(850, 500, 0, 15000)]
    [InlineData(851, 500, 1, 15050)]
    public void Fuel_settlement_tiers_respect_free_and_first_band_boundaries(decimal personal, decimal first, decimal second, decimal fee)
    {
        var draft = new SettlementDraft(0, new(), [new(Guid.NewGuid(), 0, 2000, 0, personal, 600)]);
        var result = FuelSettlementCalculator.Calculate(draft);
        Assert.Equal(first, result.Lines[0].FirstBandKm); Assert.Equal(second, result.Lines[0].SecondBandKm); Assert.Equal(fee, result.Amount);
    }
    [Fact]
    public void Fuel_settlement_reproduces_legacy_amount_and_allocates_one_allowance_across_cars()
    {
        var id = Guid.NewGuid();
        var single = new SettlementDraft(0, new(), [new(id, 123312, 126265, 170.46m, 1008, 595)]);
        Assert.Equal(45499.66m, FuelSettlementCalculator.Calculate(single).Amount);
        var multi = new SettlementDraft(0, new(), [new(id, 0, 1500, 100, 800, 600), new(Guid.NewGuid(), 0, 1500, 100, 800, 600)]);
        var result = FuelSettlementCalculator.Calculate(multi);
        Assert.Equal(350m, result.Lines.Sum(x => x.FreeKm)); Assert.Equal(500m, result.Lines.Sum(x => x.FirstBandKm));
        Assert.Equal(750m, result.Lines.Sum(x => x.SecondBandKm)); Assert.Equal(102500m, result.Amount);
        Assert.Equal(result.Amount, FuelSettlementCalculator.Calculate(multi with { Lines = multi.Lines.Reverse().ToArray() }).Amount);
    }
    [Fact]
    public void Fuel_settlement_missing_is_distinct_from_zero_and_invalid_distance_blocks_amount()
    {
        var line = new SettlementLineInput(Guid.NewGuid(), 0, 1000, 50, null, 600);
        var draft = new SettlementDraft(0, new(), [line]);
        Assert.Null(FuelSettlementCalculator.Calculate(draft).Amount);
        Assert.Equal(0, FuelSettlementCalculator.Calculate(draft with { Lines = [line with { PrivateKm = 0, UnitPrice = null }] }).Amount);
        Assert.Null(FuelSettlementCalculator.Calculate(draft with { Lines = [line with { PrivateKm = 900, UnitPrice = null }] }).Amount);
        Assert.Null(FuelSettlementCalculator.Calculate(draft with { Lines = [line with { PrivateKm = 1200 }] }).Amount);
        Assert.Null(FuelSettlementCalculator.Calculate(draft with { AgreedAmount = 100 }).Amount);
    }
    internal static byte[] LegacyBook(DateOnly month, string registration, string privateValue = "1008", string price = "595", string fee = "45499.659532678634")
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, true))
        {
            void Add(string name, string data) { using var writer = new StreamWriter(zip.CreateEntry(name).Open(), Encoding.UTF8); writer.Write(data); }
            var title = new[] { "Január", "Február", "Március", "Április", "Május", "Június", "Július", "Augusztus", "Szeptember", "Október", "November", "December" }[month.Month - 1];
            Add("xl/workbook.xml", $"""<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{title}" sheetId="1" r:id="rId1"/></sheets></workbook>""");
            Add("xl/_rels/workbook.xml.rels", """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>""");
            var cells = new StringBuilder();
            void Text(string address, string value) => cells.Append($"<c r=\"{address}\" t=\"inlineStr\"><is><t>{SecurityElement.Escape(value)}</t></is></c>");
            void Number(string address, string value) { if (value.Length > 0) cells.Append($"<c r=\"{address}\"><v>{value}</v></c>"); }
            Text("A30", "Üzemanyag összesen"); Text("B4", registration); Text("B2", "Régi használó");
            Number("D5", "123312"); Number("D28", "126265"); Number("C8", "170.46"); Number("C40", privateValue); Number("B5", "350");
            Number("C38", price); Number("F3", "30"); Number("G3", "50"); Number("C42", fee);
            Add("xl/worksheets/sheet1.xml", $"""<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">{cells}</row></sheetData></worksheet>""");
        }
        return stream.ToArray();
    }
    [Fact]
    public void Fuel_settlement_reader_preserves_missing_cells_and_cached_amount_without_running_formulas()
    {
        var month = new DateOnly(2026, 8, 1);
        var rows = LegacyFuelSettlementReader.Read(LegacyBook(month, "LEG-001", "", ""), "legacy.xlsx", 2026);
        var row = Assert.Single(rows).Row;
        Assert.Null(row.PrivateKm); Assert.Null(row.UnitPrice); Assert.Equal(45499.659532678634m, row.OriginalAmount);
        Assert.Contains(row.Warnings, x => x.Contains("magánkilométer"));
        Assert.Throws<ManagementException>(() => LegacyFuelSettlementReader.Read([1, 2, 3], "broken.xlsx", 2026));
    }
}

public sealed partial class PermissionManagementTests
{
    private static string SettlementUrl(DateOnly month, string? user = null, string suffix = "") =>
        $"/api/v1/fuel-settlements/months/{month:yyyy-MM-dd}{suffix}" + (user is null ? "" : "?userId=" + Uri.EscapeDataString(user));
    [Fact]
    public async Task Fuel_settlement_workflow_locks_approved_snapshot_and_preserves_versions_policy_and_csv()
    {
        using var owner = await Register(); await Company(owner); var car = await FleetCar(owner, "SET-001", null);
        var month = MileageThisMonth.AddMonths(-1); var url = SettlementUrl(month);
        var draft = new SettlementDraft(0, new(), [new(car.Vehicle.Id, 123312, 126265, 170.46m, 1008, 595)]);
        var row = await ScopeOk<SettlementView>(await owner.Client.PutAsJsonAsync(url, draft));
        Assert.Equal(45499.66m, row.Calculation.Amount); Assert.Equal("Draft", row.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(url, draft)).StatusCode);
        var submitted = await ScopeOk<SettlementView>(await owner.Client.PostAsJsonAsync(SettlementUrl(month, suffix: "/submit"), new SettlementAction(row.Version)));
        var approved = await ScopeOk<SettlementView>(await owner.Client.PostAsJsonAsync(SettlementUrl(month, suffix: "/approve"), new SettlementAction(submitted.Version)));
        Assert.Equal(owner.User.Id, approved.ApprovedBy);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(url, row.Data with { Version = approved.Version })).StatusCode);
        var csv = await owner.Client.GetStringAsync(SettlementUrl(month, suffix: "/export"));
        Assert.Contains("SET-001", csv); Assert.Contains("45499,66", csv);
        (await owner.Client.PutAsJsonAsync($"/api/v1/fuel-settlements/policies/{month:yyyy-MM-dd}", new SettlementPolicyInput(0, new(900)))).EnsureSuccessStatusCode();
        var frozen = (await owner.Client.GetFromJsonAsync<SettlementView>(url))!;
        Assert.Equal(350, frozen.Data.Rules.FreeKm); Assert.Equal(45499.66m, frozen.Calculation.Amount);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync(SettlementUrl(month, suffix: "/reopen"), new SettlementAction(approved.Version))).StatusCode);
        var opened = await ScopeOk<SettlementView>(await owner.Client.PostAsJsonAsync(SettlementUrl(month, suffix: "/reopen"), new SettlementAction(approved.Version, "Kimutatás egyeztetése")));
        Assert.Null(opened.ApprovedBy);
        var history = (await owner.Client.GetFromJsonAsync<SettlementRevision[]>(SettlementUrl(month, suffix: "/history")))!;
        Assert.Equal(4, history.Length); Assert.Equal(45499.66m, history.Single(x => x.Status == "Approved").Report.Calculation.Amount);
    }
    [Fact]
    public async Task Fuel_settlement_permissions_are_company_and_operation_site_scoped_without_cross_products()
    {
        using var owner = await Register(); using var manager = await Register(); using var outsider = await Register(); using var reader = await Register();
        var company = await Company(owner); await Company(outsider);
        var a = await ScopeSite(owner, "SET-A"); var b = await ScopeSite(owner, "SET-B");
        var car = await FleetCar(owner, "SET-101", a.Id); var denied = await FleetCar(owner, "SET-102", b.Id);
        var manageA = await ScopedGroup(owner, "Pénzügy A", company.Id, [a.Id], Permissions.SettlementsManage);
        var approveB = await ScopedGroup(owner, "Jóváhagyó B", company.Id, [b.Id], Permissions.SettlementsApprove);
        await CompanyAssign(owner, manager.User.Id, manageA.Id, approveB.Id); Select(manager, company.Id);
        await Join(owner, reader, company.Id, Permissions.FuelRead);
        var month = MileageThisMonth.AddMonths(-1); var draft = new SettlementDraft(0, new(), [new(car.Vehicle.Id, 0, 1000, 50, 400, 600)]);
        var saved = await ScopeOk<SettlementView>(await manager.Client.PutAsJsonAsync(SettlementUrl(month), draft));
        Assert.Equal(HttpStatusCode.NotFound, (await manager.Client.PutAsJsonAsync(SettlementUrl(month.AddMonths(-1)), draft with { Lines = [draft.Lines[0] with { VehicleId = denied.Vehicle.Id }] })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.Client.GetAsync(SettlementUrl(month))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync(SettlementUrl(month, manager.User.Id))).StatusCode);
        var submitted = await ScopeOk<SettlementView>(await manager.Client.PostAsJsonAsync(SettlementUrl(month, suffix: "/submit"), new SettlementAction(saved.Version)));
        Assert.Equal(HttpStatusCode.NotFound, (await manager.Client.PostAsJsonAsync(SettlementUrl(month, suffix: "/approve"), new SettlementAction(submitted.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.Client.PutAsJsonAsync($"/api/v1/fuel-settlements/policies/{month:yyyy-MM-dd}", new SettlementPolicyInput(0, new()))).StatusCode);
        var otherReport = await ScopeOk<SettlementView>(await owner.Client.PutAsJsonAsync(SettlementUrl(month), draft with { Lines = [draft.Lines[0] with { VehicleId = denied.Vehicle.Id }] }));
        var otherSubmitted = await ScopeOk<SettlementView>(await owner.Client.PostAsJsonAsync(SettlementUrl(month, suffix: "/submit"), new SettlementAction(otherReport.Version)));
        // An unrelated manage grant on A must not suppress the legitimate read/approval right on B.
        Assert.Equal(HttpStatusCode.OK, (await manager.Client.GetAsync(SettlementUrl(month, owner.User.Id))).StatusCode);
        var otherApproved = await ScopeOk<SettlementView>(await manager.Client.PostAsJsonAsync(SettlementUrl(month, owner.User.Id, "/approve"), new SettlementAction(otherSubmitted.Version)));
        Assert.Equal("Approved", otherApproved.Status);
    }
    [Fact]
    public async Task Fuel_settlement_import_is_previewed_mapped_deduplicated_and_preserves_original_file()
    {
        using var owner = await Register(); await Company(owner); var car = await FleetCar(owner, "LEG-001", null);
        var month = MileageThisMonth.AddMonths(-1); var bytes = FuelSettlementCalculatorTests.LegacyBook(month, "LEG-001");
        MultipartFormDataContent Upload(string? row = null) {
            var form = new MultipartFormDataContent(); form.Add(new ByteArrayContent(bytes), "file", "legacy.xlsx"); form.Add(new StringContent(month.Year.ToString()), "year");
            if (row is not null) { form.Add(new StringContent(row), "rowId"); form.Add(new StringContent(owner.User.Id), "userId"); form.Add(new StringContent(car.Vehicle.Id.ToString()), "vehicleId"); form.Add(new StringContent("Régi elszámolás átvétele"), "reason"); }
            return form;
        }
        var preview = await ScopeOk<LegacySettlementRow[]>(await owner.Client.PostAsync("/api/v1/fuel-settlements/import/preview", Upload()));
        var source = Assert.Single(preview);
        Assert.Equal(0, (await owner.Client.GetFromJsonAsync<SettlementView>(SettlementUrl(month)))!.Version);
        var imported = await ScopeOk<SettlementView>(await owner.Client.PostAsync("/api/v1/fuel-settlements/import/draft", Upload(source.Id)));
        Assert.Equal("Draft", imported.Status); Assert.Equal(45499.66m, imported.Calculation.Amount); Assert.Single(imported.Sources);
        Assert.Equal(bytes, await owner.Client.GetByteArrayAsync(SettlementUrl(month, suffix: "/sources/" + car.Vehicle.Id)));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsync("/api/v1/fuel-settlements/import/draft", Upload(source.Id))).StatusCode);
        var history = (await owner.Client.GetFromJsonAsync<SettlementRevision[]>(SettlementUrl(month, suffix: "/history")))!;
        Assert.Single(Assert.Single(history).Report.Sources);
    }
    [Fact]
    public async Task Fuel_settlement_missing_data_blocks_submission_and_database_rls_and_history_are_protected()
    {
        using var owner = await Register(); using var other = await Register(); var company = await Company(owner); var denied = await Company(other);
        var car = await FleetCar(owner, "SET-DB", null); var month = MileageThisMonth.AddMonths(-1);
        var saved = await ScopeOk<SettlementView>(await owner.Client.PutAsJsonAsync(SettlementUrl(month), new SettlementDraft(0, new(), [new(car.Vehicle.Id, 0, 1000, 50, null, 600)])));
        Assert.Null(saved.Calculation.Amount); Assert.NotEmpty(saved.Calculation.Issues);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync(SettlementUrl(month, suffix: "/submit"), new SettlementAction(saved.Version))).StatusCode);
        await using var connection = new NpgsqlConnection(fixture.ApplicationConnection); await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var scope = new NpgsqlCommand("SELECT set_config('app.tenant_id', @id, true)", connection, transaction)) { scope.Parameters.AddWithValue("id", denied.Id.ToString()); await scope.ExecuteNonQueryAsync(); }
        foreach (var table in new[] { "fuel_settlements", "fuel_settlement_vehicles", "fuel_settlement_history" })
            await using (var count = new NpgsqlCommand($"SELECT count(*) FROM {table}", connection, transaction)) Assert.Equal(0L, await count.ExecuteScalarAsync());
        await using (var scope = new NpgsqlCommand("SELECT set_config('app.tenant_id', @id, true)", connection, transaction)) { scope.Parameters.AddWithValue("id", company.Id.ToString()); await scope.ExecuteNonQueryAsync(); }
        await using var tamper = new NpgsqlCommand("UPDATE fuel_settlement_history SET \"Status\"='Approved' WHERE \"UserId\"=@id", connection, transaction);
        tamper.Parameters.AddWithValue("id", owner.User.Id);
        Assert.Equal("55000", (await Assert.ThrowsAsync<PostgresException>(() => tamper.ExecuteNonQueryAsync())).SqlState);
    }
    [Fact]
    public async Task Fuel_settlement_driver_can_only_record_own_assigned_car_and_cannot_change_rates_or_download_annual_files()
    {
        using var owner = await Register(); using var driver = await Register(); var company = await Company(owner);
        await Join(owner, driver, company.Id, Permissions.SettlementsRead, Permissions.SettlementsRecord);
        var car = await FleetCar(owner, "SELF-001", null); var other = await FleetCar(owner, "SELF-002", null);
        (await owner.Client.PutAsJsonAsync(CarUrl(car) + "/assignee", new AssignUserInput(driver.User.Id, car.Vehicle.Version))).EnsureSuccessStatusCode();
        var month = MileageThisMonth; var draft = new SettlementDraft(0, new(), [new(car.Vehicle.Id, 0, 1000, 50, 100, 600)]);
        var row = await ScopeOk<SettlementView>(await driver.Client.PutAsJsonAsync(SettlementUrl(month), draft));
        Assert.Equal(0, row.Calculation.Amount);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.PutAsJsonAsync(SettlementUrl(month), row.Data with { Rules = new(1000), Reason = "Keretcsere" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.PutAsJsonAsync(SettlementUrl(month), row.Data with { AgreedAmount = 1, AgreementReason = "Saját kedvezmény", Reason = "Próba" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.PutAsJsonAsync(SettlementUrl(month), row.Data with { Lines = [draft.Lines[0] with { VehicleId = other.Vehicle.Id }], Reason = "Másik autó" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.GetAsync(SettlementUrl(month, suffix: "/sources/" + car.Vehicle.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.GetAsync(SettlementUrl(month, owner.User.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await driver.Client.PostAsJsonAsync(SettlementUrl(month, suffix: "/submit"), new SettlementAction(row.Version))).StatusCode);
        var options = (await driver.Client.GetFromJsonAsync<SettlementOptions>($"/api/v1/fuel-settlements/options?month={month:yyyy-MM-dd}"))!;
        Assert.Equal(car.Vehicle.Id, Assert.Single(options.Vehicles).Id);
    }
    [Fact]
    public async Task Fuel_settlement_recorded_fuel_is_snapshotted_and_a_missing_month_is_not_a_fake_zero()
    {
        using var owner = await Register(); await Company(owner); var car = await FleetCar(owner, "SUM-001", null);
        var month = MileageThisMonth.AddMonths(-1); var fuelUrl = CarUrl(car) + "/fuel";
        var input = new FuelEntryInput(month, 1200, 50, 30000, "HUF", "REF-1");
        var fuel = await ScopeOk<FuelEntryRow>(await owner.Client.PostAsJsonAsync(fuelUrl, input));
        var draft = new SettlementDraft(0, new(), [new(car.Vehicle.Id, 0, 1000, null, 500, 600, true)]);
        var saved = await ScopeOk<SettlementView>(await owner.Client.PutAsJsonAsync(SettlementUrl(month), draft));
        Assert.Equal(50, saved.Data.Lines[0].Liters); Assert.False(saved.Data.Lines[0].UseRecordedFuel);
        (await owner.Client.PutAsJsonAsync(fuelUrl + "/" + fuel.Id, new UpdateFuelEntryInput(input with { Liters = 60 }, fuel.Version, "Tankolás javítása"))).EnsureSuccessStatusCode();
        Assert.Equal(saved.Calculation.Amount, (await owner.Client.GetFromJsonAsync<SettlementView>(SettlementUrl(month)))!.Calculation.Amount);
        var noFuel = await ScopeOk<SettlementView>(await owner.Client.PutAsJsonAsync(SettlementUrl(month.AddMonths(-1)), draft));
        Assert.Null(noFuel.Data.Lines[0].Liters); Assert.Null(noFuel.Calculation.Amount);
    }
}
