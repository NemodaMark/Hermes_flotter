using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class CsvImportTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    private static readonly byte[] Pdf = "%PDF-1.7\n%%EOF"u8.ToArray();
    private static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzEAAAAASUVORK5CYII=");

    [Fact]
    public async Task PackageRollsBackAndImportsDocumentsWithoutCrossingCompanyOrSiteScopes()
    {
        var name = "CSV import " + Guid.NewGuid().ToString("N");
        var folder = Directory.CreateTempSubdirectory("hermes-csv-");
        var zip = folder.FullName + ".zip";
        try
        {
            var package = folder.CreateSubdirectory("Flotta export");
            void Csv(string name, string content) => File.WriteAllText(Path.Combine(package.FullName, name + ".csv"), content);
            Csv("companies", $"""
                company_ref,name,country_code,time_zone,currency,distance_unit
                a,"{name}, A",HU,Europe/Budapest,HUF,km
                b,"{name}, B",HU,Europe/Budapest,HUF,km
                """);
            Csv("users", """
                user_ref,username,display_name,email
                member,anna,Kovács Anna,anna@example.test
                local,csv.new,Új próba,csv-new@example.test
                """);
            Csv("sites", """
                company_ref,site_ref,code,name,country_code
                a,site,01,Központ,HU
                a,other,02,Másik,HU
                b,site,01,Központ,HU
                """);
            Csv("groups", "group_ref,name\ndriver,Olvasó csoport\n");
            Csv("group_companies", "group_ref,company_ref,restrict_sites\ndriver,a,true\n");
            Csv("group_sites", "group_ref,company_ref,site_ref\ndriver,a,site\n");
            Csv("group_permissions", "group_ref,permission_code\ndriver,vehicles.read\ndriver,vehicles.documents.read\n");
            Csv("group_users", "group_ref,user_ref\ndriver,member\n");
            Csv("admin_companies", "company_ref,user_ref\nb,local\n");
            Csv("vehicles", """
                company_ref,vehicle_ref,registration,make,model,site_ref,odometer_km,notes
                a,car,AB-CD-123,Škoda,Octavia,site,24500,"Első sor, ""idézet""
                Második sor."
                a,hidden,AB-CD-124,Škoda,Octavia,other,100,
                b,car,AB-CD-123,Fiat,Ducato,site,37,
                """);
            Csv("registrations", """
                company_ref,registration_ref,vehicle_ref,registration,country_code,recorded_at,recorded_by_ref
                a,r1,car,ABC-456,HU,2020-01-04T08:30:00+01:00,member
                """);
            Csv("odometer", "company_ref,reading_ref,vehicle_ref,kilometers,recorded_at\na,km,car,23500,2020-01-04T07:30:00Z\n");
            Csv("bookings", "company_ref,booking_ref,vehicle_ref,user_ref,starts_on,ends_on\na,history,car,member,2020-01-07,2020-01-09\n");
            Csv("partners", "company_ref,partner_ref,name,is_lessor,is_service,country_code\na,partner,Minta Partner,true,true,HU\n");
            Csv("leases", "company_ref,lease_ref,vehicle_ref,partner_ref,contract_number,start_date,end_date,currency,billing_frequency,status\na,lease,car,partner,K-150,2018-01-02,2019-12-20,HUF,Monthly,Closed\n");
            Csv("services", "company_ref,service_ref,vehicle_ref,partner_ref,performed_on,description,currency\na,service,car,partner,2020-01-04,Olajcsere,HUF\n");
            Csv("fuel_entries", "company_ref,fuel_ref,vehicle_ref,fueled_on,kilometers,liters,amount,currency\na,fuel,car,2020-01-04,23500,45.25,13000,HUF\n");
            Csv("handovers", "company_ref,handover_ref,vehicle_ref,recorded_at,kilometers,condition,next_user_ref\na,handover,car,2020-01-04T07:30:00Z,23500,Rendben,member\n");
            var media = package.CreateSubdirectory("files");
            File.WriteAllBytes(Path.Combine(media.FullName, "forgalmi.pdf"), Pdf);
            File.WriteAllBytes(Path.Combine(media.FullName, "foto.png"), Png);
            var sha = Convert.ToHexStringLower(SHA256.HashData(Pdf));
            var photoHash = Convert.ToHexStringLower(SHA256.HashData(Png));
            string Manifest(string digest, string company = "a", string vehicle = "car") => $"""
                company_ref,file_ref,owner_kind,owner_ref,relative_path,original_name,sha256,byte_length,category
                {company},f,vehicle_document,{vehicle},files/forgalmi.pdf,forgalmi.pdf,{digest},{Pdf.Length},Registration
                a,lease,lease_document,lease,files/forgalmi.pdf,contract.pdf,{sha},{Pdf.Length},
                a,service,service_document,service,files/forgalmi.pdf,service.pdf,{sha},{Pdf.Length},
                a,car-photo,vehicle_photo,car,files/foto.png,foto.png,{photoHash},{Png.Length},
                a,fuel-photo,fuel_receipt,fuel,files/foto.png,foto.png,{photoHash},{Png.Length},
                a,handover-photo,handover_photo,handover,files/foto.png,foto.png,{photoHash},{Png.Length},
                ,avatar,avatar,local,files/foto.png,foto.png,{photoHash},{Png.Length},
                """;
            Csv("files", Manifest(sha));

            var review = await Run(package.FullName);
            Assert.Equal("validated", review.Status);
            Assert.Equal(3, review.Rows["vehicles"]);
            Assert.Equal(1, review.NewLocalAccounts);
            Assert.Equal(1, review.ExistingAccounts);
            Assert.False(await Exists(name));

            Csv("files", Manifest(new string('0', 64)));
            var error = await Assert.ThrowsAsync<InvalidDataException>(() => Run(package.FullName, apply: true));
            Assert.Contains("files.csv:2", error.Message);
            Assert.Contains("SHA-256", error.Message);
            Assert.False(await Exists(name));

            Csv("files", Manifest(sha, "b", "hidden"));
            var wrongCompany = await Assert.ThrowsAsync<InvalidDataException>(() => Run(package.FullName, apply: true));
            Assert.Contains("ebben a cégben", wrongCompany.Message);
            Assert.False(await Exists(name));

            Csv("files", Manifest(sha));
            ZipFile.CreateFromDirectory(folder.FullName, zip);
            var imported = await Run(zip, apply: true);
            Assert.Equal("imported", imported.Status);
            Assert.Equal(review.Fingerprint, imported.Fingerprint);
            Assert.Equal("already_imported", (await Run(package.FullName, apply: true)).Status);

            var company = imported.Companies["a"];
            await using (var registry = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext()))
            {
                var adminCompany = await registry.GroupUserCompanies.Where(x => x.UserId == "csv.new").Select(x => x.TenantId).SingleAsync();
                Assert.Equal(imported.Companies["b"], adminCompany);
                Assert.False(await registry.SystemPermissionGrants.AnyAsync(g => g.UserId == "csv.new"));
            }
            Guid vehicle;
            Guid document;
            var context = new TenantContext();
            context.Set(company, "anna", Permissions.All);
            await using (var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context))
            {
                (vehicle, document) = await TenantTransaction.RunAsync(db, company, async () =>
                {
                    var car = await db.Vehicles.SingleAsync(x => x.Registration == "AB-CD-123");
                    var profile = await db.VehicleProfiles.SingleAsync(x => x.VehicleId == car.Id);
                    Assert.Contains("Első sor, \"idézet\"", profile.Notes);
                    Assert.Contains("Második sor.", profile.Notes);
                    Assert.Equal(24500, car.OdometerKm);
                    Assert.True(await db.VehicleRegistrations.AnyAsync(x => x.VehicleId == car.Id && x.Registration == "ABC-456"
                        && x.RecordedAt == new DateTimeOffset(2020, 1, 4, 7, 30, 0, TimeSpan.Zero)));
                    Assert.True(await db.VehicleBookings.AnyAsync(x => x.VehicleId == car.Id && x.UserId == "anna"));
                    var file = await db.VehicleDocuments.SingleAsync(x => x.VehicleId == car.Id);
                    Assert.Equal(sha, file.Sha256);
                    Assert.Equal(VehicleDocumentCategories.Registration, file.Category);
                    Assert.Equal(3, await db.VehicleDocuments.CountAsync());
                    Assert.NotNull((await db.VehicleFuelEntries.SingleAsync()).Receipt);
                    Assert.NotNull((await db.VehicleHandovers.SingleAsync()).Photo);
                    Assert.NotEqual(photoHash, (await db.VehiclePhotos.SingleAsync()).Sha256);
                    Assert.True(await db.UserAvatars.AnyAsync(x => x.UserId == "csv.new"));
                    return (car.Id, file.Id);
                }, CancellationToken.None);
            }

            using var member = await fixture.ClientAsync("anna", company);
            var request = await member.GetAsync($"/api/v1/vehicles/{vehicle}/documents/{document}/content");
            request.EnsureSuccessStatusCode();
            Assert.Equal(Pdf, await request.Content.ReadAsByteArrayAsync());
            var listing = await member.GetFromJsonAsync<JsonElement>("/api/v1/vehicles");
            Assert.Contains("AB-CD-123", listing.GetRawText());
            Assert.DoesNotContain("AB-CD-124", listing.GetRawText());
            using var otherCompany = await fixture.ClientAsync("anna", imported.Companies["b"]);
            Assert.Equal(HttpStatusCode.Forbidden, (await otherCompany.GetAsync("/api/v1/vehicles")).StatusCode);
        }
        finally
        {
            folder.Delete(recursive: true);
            File.Delete(zip);
        }
    }

    [Fact]
    public async Task RejectsZipTraversalAndExistingCompanyNames()
    {
        var folder = Directory.CreateTempSubdirectory("hermes-csv-path-");
        try
        {
            var zip = Path.Combine(folder.FullName, "malformed.zip");
            using (var archive = ZipFile.Open(zip, ZipArchiveMode.Create))
                archive.CreateEntry("files/../not-a-file.pdf");
            var unsafePath = await Assert.ThrowsAsync<InvalidDataException>(() => Run(zip, apply: true));
            Assert.Contains("relatív útvonal", unsafePath.Message);
            File.Delete(zip);

            await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
            var name = await db.Tenants.Where(t => t.Id == TestFleetData.DunaId).Select(t => t.Name).SingleAsync();
            File.WriteAllText(Path.Combine(folder.FullName, "companies.csv"),
                $"company_ref,name,country_code,time_zone,currency,distance_unit\nexisting,\"{name.Replace("\"", "\"\"")}\",HU,Europe/Budapest,HUF,km\n");
            var duplicate = await Assert.ThrowsAsync<InvalidDataException>(() => Run(folder.FullName, apply: true));
            Assert.Contains("már létezik cég", duplicate.Message);
        }
        finally { folder.Delete(recursive: true); }
    }

    private async Task<CsvImportResult> Run(string path, bool apply = false)
    {
        await using var db = FleetFixture.CreateContext(fixture.MigrationConnection, new TenantContext());
        return await CsvImport.RunAsync(db, path, new(apply, "test.registrar"), CancellationToken.None);
    }

    private async Task<bool> Exists(string prefix)
    {
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
        return await db.Tenants.IgnoreQueryFilters().AnyAsync(t => t.Name.StartsWith(prefix))
            || await db.Users.AnyAsync(x => x.Id == "csv.new");
    }
}
