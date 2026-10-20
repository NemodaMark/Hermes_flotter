using System.Security.Cryptography;
using System.Text;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class DirectVehicleDocumentMigrationTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    [Fact]
    public async Task Direct_document_upgrade_preserves_existing_lease_and_service_files_in_every_company()
    {
        var database = $"hermes_document_upgrade_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(fixture.MigrationConnection);
        await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"CREATE DATABASE \"{database}\" OWNER \"{connection.Username}\"");
        connection.Database = database;
        var companies = new[] { Guid.NewGuid(), Guid.NewGuid() }; var ids = new List<Guid>();
        var bytes = Encoding.ASCII.GetBytes("%PDF-1.7\nRetained document\n%%EOF"); var sha = Convert.ToHexStringLower(SHA256.HashData(bytes));
        try
        {
            await using var migrationDb = FleetFixture.CreateContext(connection.ConnectionString, new TenantContext());
            await migrationDb.GetService<IMigrator>().MigrateAsync("20261020183012_VehicleDocuments");
            foreach (var company in companies)
            {
                var context = new TenantContext(); context.Set(company, "existing", Permissions.All);
                await using var db = FleetFixture.CreateContext(connection.ConnectionString, context);
                await TenantTransaction.RunAsync(db, company, async () =>
                {
                    var car = new Vehicle { TenantId = company, Registration = "OLD-DOC", Make = "Ford", Model = "Transit", Version = 7 };
                    var partner = new Partner { TenantId = company, Name = "Existing partner", CreatedBy = "existing" };
                    var lease = new VehicleLease { TenantId = company, VehicleId = car.Id, PartnerId = partner.Id, ContractNumber = "OLD-LEASE", CreatedBy = "existing" };
                    var service = new VehicleService { TenantId = company, VehicleId = car.Id, PartnerId = partner.Id, Description = "Existing work", CreatedBy = "existing" };
                    db.AddRange(new Tenant { Id = company, Name = "Existing company" }, car, partner, lease, service); await db.SaveChangesAsync();
                    foreach (var isLease in new[] { true, false })
                    {
                        var id = Guid.NewGuid(); ids.Add(id); Guid? leaseId = isLease ? lease.Id : null; Guid? serviceId = isLease ? null : service.Id;
                        await db.Database.ExecuteSqlInterpolatedAsync($"""
                            INSERT INTO vehicle_documents ("TenantId","Id","LeaseId","ServiceId","FileName","ContentType","ByteLength","Sha256","UploadedBy","UploadedAt","Version","IsWithdrawn")
                            VALUES ({company},{id},{leaseId},{serviceId},'existing.pdf','application/pdf',{bytes.Length},{sha},'existing','2026-10-01T10:00:00Z',3,false)
                            """);
                        db.VehicleDocumentContents.Add(new() { TenantId = company, DocumentId = id, Bytes = bytes });
                        await db.SaveChangesAsync();
                    }
                    return true;
                }, default);
            }
            await migrationDb.Database.MigrateAsync();
            Assert.False(migrationDb.Database.HasPendingModelChanges());
            Assert.Equal(Permissions.Catalog.Count, await migrationDb.PermissionDefinitions.CountAsync());
            foreach (var company in companies)
            {
                var context = new TenantContext(); context.Set(company, "existing", Permissions.All);
                await using var db = FleetFixture.CreateContext(connection.ConnectionString, context);
                await TenantTransaction.RunAsync(db, company, async () =>
                {
                    var documents = await db.VehicleDocuments.AsNoTracking().ToArrayAsync(); Assert.Equal(2, documents.Length);
                    foreach (var doc in documents)
                    {
                        Assert.Contains(doc.Id, ids); Assert.Null(doc.VehicleId); Assert.Null(doc.Category); Assert.Equal(3, doc.Version);
                        Assert.Equal("existing.pdf", doc.FileName); Assert.Equal("existing", doc.UploadedBy); Assert.Equal(sha, doc.Sha256); Assert.Equal(bytes.Length, doc.ByteLength);
                        Assert.Equal(DateTimeOffset.Parse("2026-10-01T10:00:00Z"), doc.UploadedAt);
                        Assert.Equal(bytes, await db.VehicleDocumentContents.Where(x => x.DocumentId == doc.Id).Select(x => x.Bytes).SingleAsync());
                    }
                    Assert.Equal(7, (await db.Vehicles.SingleAsync()).Version);
                    return true;
                }, default);
            }
        }
        finally { await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE)"); }
    }
}
