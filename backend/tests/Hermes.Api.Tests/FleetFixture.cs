using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class FleetFixture : IAsyncLifetime
{
    private PostgreSqlContainer? container;
    private string adminConnection = "";
    private readonly string suffix = Guid.NewGuid().ToString("N");
    public string ApplicationConnection { get; private set; } = "";
    public string MigrationConnection { get; private set; } = "";
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    private string Database => $"hermes_tests_{suffix}";
    private string Migrator => $"migrator_{suffix}";
    private string AppRole => $"app_{suffix}";

    public async Task InitializeAsync()
    {
        adminConnection = Environment.GetEnvironmentVariable("HERMES_TEST_ADMIN_CONNECTION") ?? "";
        if (string.IsNullOrWhiteSpace(adminConnection))
        {
            container = new PostgreSqlBuilder("postgres:18-alpine").Build();
            await container.StartAsync();
            adminConnection = container.GetConnectionString();
        }

        var password = Guid.NewGuid().ToString("N");
        await ExecuteAsync(adminConnection, $"""
            CREATE ROLE "{Migrator}" LOGIN PASSWORD '{password}' NOSUPERUSER NOBYPASSRLS;
            CREATE ROLE "{AppRole}" LOGIN PASSWORD '{password}' NOSUPERUSER NOBYPASSRLS;
            """);
        await ExecuteAsync(adminConnection, $"CREATE DATABASE \"{Database}\" OWNER \"{Migrator}\"");
        MigrationConnection = new NpgsqlConnectionStringBuilder(adminConnection)
            { Database = Database, Username = Migrator, Password = password }.ConnectionString;
        ApplicationConnection = new NpgsqlConnectionStringBuilder(MigrationConnection) { Username = AppRole }.ConnectionString;
        await ExecuteAsync(MigrationConnection, $"""
            REVOKE CREATE ON SCHEMA public FROM PUBLIC;
            GRANT USAGE ON SCHEMA public TO "{AppRole}";
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "{AppRole}";
            """);
        await using (var db = CreateContext(MigrationConnection, new TenantContext()))
            await db.Database.MigrateAsync();
        foreach (var tenantId in new[] { DevelopmentSeed.DunaId, DevelopmentSeed.PannonId })
        {
            var context = new TenantContext();
            context.Set(tenantId, FleetRole.Owner);
            await using var db = CreateContext(MigrationConnection, context);
            await DevelopmentSeed.ApplyAsync(db, context);
        }
        Factory = CreateFactory();
    }

    public WebApplicationFactory<Program> CreateFactory(string environment = "Development", bool developmentAuthentication = true)
        => new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder
            .UseEnvironment(environment)
            .UseSetting("ConnectionStrings:Database", ApplicationConnection)
            .UseSetting("Authentication:EnableDevelopmentAuthentication", developmentAuthentication.ToString())
            .UseSetting("Authentication:Authority", "https://identity.example.invalid")
            .UseSetting("Authentication:Audience", "hermes"));

    public HttpClient Client(string? user = "anna", Guid? tenantId = null)
    {
        var client = Factory.CreateClient();
        if (user is not null) client.DefaultRequestHeaders.Add("X-Development-User", user);
        if (tenantId is not null) client.DefaultRequestHeaders.Add("X-Tenant-Id", tenantId.ToString());
        return client;
    }

    public static HermesDbContext CreateContext(string connection, TenantContext context)
        => new(new DbContextOptionsBuilder<HermesDbContext>().UseNpgsql(connection).Options, context);

    public static async Task ExecuteAsync(string connectionString, string sql)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    public async Task DisposeAsync()
    {
        if (Factory is not null) await Factory.DisposeAsync();
        NpgsqlConnection.ClearAllPools();
        if (!string.IsNullOrEmpty(adminConnection))
        {
            await ExecuteAsync(adminConnection, $"DROP DATABASE IF EXISTS \"{Database}\" WITH (FORCE)");
            await ExecuteAsync(adminConnection, $"DROP ROLE IF EXISTS \"{AppRole}\"; DROP ROLE IF EXISTS \"{Migrator}\";");
        }
        if (container is not null) await container.DisposeAsync();
    }
}
