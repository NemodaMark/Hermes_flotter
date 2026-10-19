using System.Net;
using System.Net.Http.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class TenantIsolationTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    [Fact]
    public async Task Anonymous_requests_are_unauthorized()
    {
        using var client = fixture.Client(null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/tenants")).StatusCode);
    }

    [Fact]
    public async Task Tenant_header_cannot_grant_membership()
    {
        using var client = fixture.Client("bela", DevelopmentSeed.PannonId);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/v1/vehicles")).StatusCode);
    }

    [Fact]
    public async Task Missing_tenant_is_rejected()
    {
        using var client = fixture.Client();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/v1/vehicles")).StatusCode);
    }

    [Fact]
    public async Task Users_only_see_their_own_memberships()
    {
        using var client = fixture.Client("bela");
        var memberships = await client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants");
        Assert.Equal(DevelopmentSeed.DunaId, Assert.Single(memberships!).Id);
    }

    [Fact]
    public async Task Switching_tenants_does_not_reuse_the_previous_tenant_filter()
    {
        using var duna = fixture.Client("anna", DevelopmentSeed.DunaId);
        using var pannon = fixture.Client("anna", DevelopmentSeed.PannonId);
        var first = await duna.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles");
        var second = await pannon.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles");
        Assert.Contains(first!, vehicle => vehicle.Registration == "HER-204");
        Assert.DoesNotContain(second!, vehicle => vehicle.Registration == "HER-204");
        Assert.Contains(second!, vehicle => vehicle.Registration == "PAN-310");
        Assert.DoesNotContain(first!, vehicle => vehicle.Registration == "PAN-310");
    }

    [Fact]
    public async Task Vehicle_ids_cannot_be_used_to_read_another_companys_vehicle()
    {
        using var duna = fixture.Client("anna", DevelopmentSeed.DunaId);
        using var pannon = fixture.Client("anna", DevelopmentSeed.PannonId);
        var list = await duna.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles");
        var vehicle = list!.First();
        Assert.Equal(HttpStatusCode.OK, (await duna.GetAsync($"/api/v1/vehicles/{vehicle.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await pannon.GetAsync($"/api/v1/vehicles/{vehicle.Id}")).StatusCode);
    }

    [Fact]
    public async Task Viewer_cannot_create_a_vehicle()
    {
        using var client = fixture.Client("bela", DevelopmentSeed.DunaId);
        var response = await client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("READ-001", "Ford", "Focus"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Registrations_are_unique_within_each_tenant()
    {
        using var duna = fixture.Client("anna", DevelopmentSeed.DunaId);
        using var pannon = fixture.Client("anna", DevelopmentSeed.PannonId);
        var request = new CreateVehicleRequest("test-123", "Ford", "Focus");
        Assert.Equal(HttpStatusCode.Created, (await duna.PostAsJsonAsync("/api/v1/vehicles", request)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await duna.PostAsJsonAsync("/api/v1/vehicles", request)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await pannon.PostAsJsonAsync("/api/v1/vehicles", request)).StatusCode);
    }

    [Fact]
    public async Task Empty_vehicle_fields_are_rejected()
    {
        using var client = fixture.Client("anna", DevelopmentSeed.DunaId);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest(" ", "Ford", "Focus"))).StatusCode);
    }

    [Fact]
    public async Task Database_denies_unscoped_reads_and_cross_tenant_writes()
    {
        await using var connection = new NpgsqlConnection(fixture.ApplicationConnection);
        await connection.OpenAsync();
        await using (var unscoped = new NpgsqlCommand("SELECT count(*) FROM vehicles", connection))
            Assert.Equal(0L, await unscoped.ExecuteScalarAsync());

        await using var transaction = await connection.BeginTransactionAsync();
        await using (var scope = new NpgsqlCommand("SELECT set_config('app.tenant_id', @tenant, true)", connection, transaction))
        {
            scope.Parameters.AddWithValue("tenant", DevelopmentSeed.DunaId.ToString());
            await scope.ExecuteNonQueryAsync();
        }
        await using (var scoped = new NpgsqlCommand("SELECT count(*) FROM vehicles WHERE \"TenantId\" = @other", connection, transaction))
        {
            scoped.Parameters.AddWithValue("other", DevelopmentSeed.PannonId);
            Assert.Equal(0L, await scoped.ExecuteScalarAsync());
        }
        await using var insert = new NpgsqlCommand("""
            INSERT INTO vehicles ("TenantId", "Id", "Registration", "Make", "Model", "Status", "CreatedAt")
            VALUES (@other, @id, 'BAD-001', 'Ford', 'Focus', 'Active', now())
            """, connection, transaction);
        insert.Parameters.AddWithValue("other", DevelopmentSeed.PannonId);
        insert.Parameters.AddWithValue("id", Guid.NewGuid());
        var exception = await Assert.ThrowsAsync<PostgresException>(() => insert.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, exception.SqlState);
    }

    [Fact]
    public async Task Ef_writes_require_a_matching_tenant_even_with_explicit_save_options()
    {
        var context = new TenantContext();
        context.Set(DevelopmentSeed.DunaId, FleetRole.Owner);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        db.Vehicles.Add(new Vehicle { TenantId = DevelopmentSeed.PannonId, Registration = "BAD-002", Make = "Ford", Model = "Focus" });
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync(true));
    }

    [Fact]
    public async Task Production_does_not_accept_development_identity_headers()
    {
        await using var factory = fixture.CreateFactory("Production", false);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Development-User", "anna");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/tenants")).StatusCode);
    }

    [Fact]
    public void Development_authentication_cannot_be_enabled_in_production()
    {
        using var factory = fixture.CreateFactory("Production", true);
        Assert.Throws<InvalidOperationException>(() => factory.CreateClient());
    }
}
