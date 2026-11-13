using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    [Fact]
    public async Task Booking_calendar_requires_its_own_site_rights_and_serializes_overlapping_weeks()
    {
        using var owner = await Register();
        using var driver = await Register();
        using var outsider = await Register();
        var company = await Company(owner);
        var other = await Company(outsider);
        var site = await ScopeSite(owner, "FOG-A");
        var unusedSite = await ScopeSite(owner, "FOG-B");
        var car = await FleetCar(owner, "FOG-001", site.Id);
        var denied = await FleetCar(owner, "FOG-002", unusedSite.Id);
        var foreign = await FleetCar(outsider, "FOG-OTHER");
        var group = await ScopedGroup(owner, "Foglaló", company.Id, [site.Id], Permissions.VehiclesRead, Permissions.BookingsRead, Permissions.BookingsCreate);
        await CompanyAssign(owner, driver.User.Id, group.Id);
        Select(driver, company.Id);
        var path = CarUrl(car) + "/bookings";
        var local = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Europe/Budapest"));
        var start = DateOnly.FromDateTime(local.DateTime).AddDays(2);
        var month = new DateOnly(start.Year, start.Month, 1);
        var suffix = $"/bookings?month={month:yyyy-MM-dd}";
        var week = new BookingInput(start, start.AddDays(6));
        Assert.Equal(HttpStatusCode.NotFound, (await driver.Client.GetAsync(CarUrl(denied) + suffix)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await driver.Client.GetAsync(CarUrl(foreign) + suffix)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.PutAsJsonAsync(CarUrl(car) + "/booking-settings", new BookingSettingsInput(true))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await driver.Client.PostAsJsonAsync(path, week)).StatusCode);
        (await owner.Client.PutAsJsonAsync(CarUrl(car) + "/booking-settings", new BookingSettingsInput(true))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await driver.Client.PostAsJsonAsync(path, week with { EndsOn = start.AddDays(7) })).StatusCode);
        var results = await Task.WhenAll(driver.Client.PostAsJsonAsync(path, week), owner.Client.PostAsJsonAsync(path, week));
        Assert.Single(results, x => x.StatusCode == HttpStatusCode.OK);
        Assert.Single(results, x => x.StatusCode == HttpStatusCode.Conflict);
        var calendar = (await driver.Client.GetFromJsonAsync<BookingCalendar>(CarUrl(car) + suffix))!;
        Assert.True(calendar.Enabled);
        var current = Assert.Single(calendar.Items);
        Assert.Equal(week.StartsOn, current.StartsOn);
        Assert.Equal(week.EndsOn, current.EndsOn);
        Assert.NotEmpty(current.Name);
        (await owner.Client.DeleteAsync(path + "/" + current.Id + "?manage=true")).EnsureSuccessStatusCode();
        (await driver.Client.PostAsJsonAsync(path, week)).EnsureSuccessStatusCode();
        var today = calendar.Today;
        var todayBooking = new BookingInput(today, today.AddDays(1));
        (await driver.Client.PostAsJsonAsync(path, todayBooking)).EnsureSuccessStatusCode();
        var list = (await driver.Client.GetFromJsonAsync<VehicleListPage>("/api/v1/vehicles/search"))!;
        Assert.Equal(week.EndsOn.AddDays(1), Assert.Single(list.Items).BookingAvailability?.AvailableFrom);
        Select(driver, other.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.GetAsync(CarUrl(foreign) + suffix)).StatusCode);
    }

    [Fact]
    public async Task Operational_records_commit_together_and_fuel_exports_only_live_entries()
    {
        using var owner = await Register();
        using var driver = await Register();
        using var foreign = await Register();
        var company = await Company(owner);
        await Company(foreign);
        await Join(owner, driver, company.Id, Permissions.VehiclesRead);
        var car = await FleetCar(owner, "OPS-001");
        var url = CarUrl(car);
        var transfer = new HandoverInput(driver.User.Id, 12345, "Rendben", "Átvétel", car.Vehicle.Version);
        var transferRow = await ScopeOk<HandoverRow>(await owner.Client.PostAsync(url + "/handovers", WithPhoto(transfer)));
        Assert.True(transferRow.HasPhoto);
        Assert.Equal("image/jpeg", (await owner.Client.GetAsync(url + $"/handovers/{transferRow.Id}/photo")).Content.Headers.ContentType?.MediaType);
        var current = (await owner.Client.GetFromJsonAsync<VehicleRecord>(url + "/details"))!;
        Assert.Equal(12345, current.Vehicle.OdometerKm);
        Assert.Equal(car.Vehicle.Version + 1, current.Vehicle.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync(url + "/handovers", transfer)).StatusCode);
        var handovers = (await owner.Client.GetFromJsonAsync<PageResult<HandoverRow>>(url + "/handovers"))!;
        Assert.Equal(driver.User.Id, Assert.Single(handovers.Items).NextUserId);
        var history = (await owner.Client.GetFromJsonAsync<PageResult<VehicleAssignmentHistory>>(url + "/assignee-history"))!;
        Assert.Single(history.Items);
        var date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);
        var month = new DateOnly(date.Year, date.Month, 1);
        var fuel = new FuelEntryInput(date, 12300, 40.5m, 24123.25m, "HUF");
        var row = await ScopeOk<FuelEntryRow>(await owner.Client.PostAsync(url + "/fuel", WithPhoto(fuel)));
        Assert.True(row.HasReceipt);
        var receipt = url + $"/fuel/{row.Id}/receipt";
        Assert.Equal("image/jpeg", (await owner.Client.GetAsync(receipt)).Content.Headers.ContentType?.MediaType);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.GetAsync(receipt)).StatusCode);
        var export = url + $"/fuel/export?month={month:yyyy-MM-dd}";
        Assert.Contains("12300;40,5;24123,25;HUF", await owner.Client.GetStringAsync(export));
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.GetAsync(export)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.PostAsJsonAsync(url + "/fuel", fuel)).StatusCode);
        (await owner.Client.PostAsJsonAsync(url + $"/fuel/{row.Id}/void", new { reason = "Dupla rögzítés" })).EnsureSuccessStatusCode();
        Assert.DoesNotContain("12300", await owner.Client.GetStringAsync(export));
        Assert.Equal(12345, (await owner.Client.GetFromJsonAsync<VehicleRecord>(url + "/details"))!.Vehicle.OdometerKm);
        (await owner.Client.PutAsJsonAsync(url + "/service-appointment", new ServiceAppointmentInput(DateTimeOffset.UtcNow.AddDays(2), "Gumicsere"))).EnsureSuccessStatusCode();
        Assert.Contains("Gumicsere", await owner.Client.GetStringAsync(url + "/service-appointment"));
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(url + "/service-appointment")).StatusCode);
    }

    [Fact]
    public async Task Fleet_reminders_claim_once_for_confirmed_recipients_with_current_site_access()
    {
        using var owner = await Register();
        using var restricted = await Register();
        var company = await Company(owner);
        var a = await ScopeSite(owner, "REM-A");
        var b = await ScopeSite(owner, "REM-B");
        var car = await FleetCar(owner, "REM-001", a.Id);
        var group = await ScopedGroup(owner, "Másik telephely", company.Id, [b.Id], Permissions.VehiclesRead, Permissions.VehiclesUpdate,
            Permissions.ServicesRead, Permissions.ServicesManage);
        await CompanyAssign(owner, restricted.User.Id, group.Id);
        var now = DateTimeOffset.UtcNow;
        var date = DateOnly.FromDateTime(now.UtcDateTime).AddDays(5);
        var url = CarUrl(car);
        var spec = car.Data with { InspectionDueDate = date, InsuranceDueDate = date, NextServiceDate = date, NextServiceKm = 5000 };
        var saved = await ScopeOk<VehicleRecord>(await owner.Client.PutAsJsonAsync(url + "/details",
            new SaveVehicleRecord(car.Vehicle.Registration, car.Vehicle.Make, car.Vehicle.Model, "Active", car.Vehicle.Version, spec)));
        (await owner.Client.PostAsJsonAsync(url + "/odometer", new RecordOdometerRequest(4000, saved.Vehicle.Version))).EnsureSuccessStatusCode();
        (await owner.Client.PutAsJsonAsync(url + "/service-appointment", new ServiceAppointmentInput(now.AddDays(4), null))).EnsureSuccessStatusCode();

        var actor = new TenantContext();
        actor.Set(company.Id, "system:fleet-reminders", []);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, actor);
        await db.Users.Where(x => x.Id == owner.User.Id || x.Id == restricted.User.Id)
            .ExecuteUpdateAsync(set => set.SetProperty(x => x.EmailConfirmed, true));
        var service = new FleetReminders(db);
        var events = await service.Claim(company.Id, now, default);
        Assert.Equal(5, events.Length);
        Assert.All(events, item => Assert.Equal(owner.User.Id, item.UserId));
        Assert.True(await service.CanDeliver(company.Id, events[0], default));
        await db.Users.Where(x => x.Id == owner.User.Id).ExecuteUpdateAsync(set => set.SetProperty(x => x.EmailConfirmed, false));
        Assert.False(await service.CanDeliver(company.Id, events[0], default));
        await db.Users.Where(x => x.Id == owner.User.Id).ExecuteUpdateAsync(set => set.SetProperty(x => x.EmailConfirmed, true));
        Assert.Empty(await service.Claim(company.Id, now.AddMinutes(5), default));
        foreach (var item in events) Assert.True(await service.MarkDelivered(company.Id, item, default));
        db.ChangeTracker.Clear();
        Assert.Empty(await service.Claim(company.Id, now.AddHours(1), default));
    }

    private static MultipartFormDataContent WithPhoto<T>(T data)
    {
        var form = new MultipartFormDataContent();
        form.Add(new StringContent(JsonSerializer.Serialize(data, JsonSerializerOptions.Web)), "data");
        form.Add(new ByteArrayContent(Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzEAAAAASUVORK5CYII=")),
            "file", "test.png");
        return form;
    }
}
