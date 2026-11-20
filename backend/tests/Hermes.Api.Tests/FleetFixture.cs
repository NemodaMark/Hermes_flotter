using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using System.Net.Http.Json;
using Npgsql;
using Testcontainers.PostgreSql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class FleetFixture : IAsyncLifetime
{
    public const string Password = "Test-only-long-passphrase-42";
    private PostgreSqlContainer? container;
    private string adminConnection = "";
    private readonly string suffix = Guid.NewGuid().ToString("N");
    public string ApplicationConnection { get; private set; } = "";
    public string MigrationConnection { get; private set; } = "";
    internal string AdministrationConnection => adminConnection;
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
        foreach (var tenantId in new[] { TestFleetData.DunaId, TestFleetData.PannonId })
        {
            var context = new TenantContext();
            context.Set(tenantId, "anna", Permissions.All);
            await using var db = CreateContext(MigrationConnection, context);
            await TestFleetData.ApplyAsync(db, context);
        }
        Factory = CreateFactory();
        await using var userScope = Factory.Services.CreateAsyncScope();
        var users = userScope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        foreach (var name in new[] { "anna", "bela" })
        {
            var result = await users.CreateAsync(new ApplicationUser { Id = name, UserName = name, Email = $"{name}@example.test", DisplayName = name == "anna" ? "Kovács Anna" : "Nagy Béla" }, Password);
            if (!result.Succeeded) throw new InvalidOperationException("Could not create the test identity.");
        }
        var registrar = new ApplicationUser { Id = "test.registrar", UserName = "test.registrar", Email = "test.registrar@example.test", DisplayName = "Test Registrar" };
        if (!(await users.CreateAsync(registrar, Password)).Succeeded) throw new InvalidOperationException("Could not create the test registrar.");
        var registry = userScope.ServiceProvider.GetRequiredService<HermesDbContext>();
        registry.SystemPermissionGrants.Add(new() { UserId = registrar.Id, Code = Hermes.Domain.SystemPermissions.Manage });
        await registry.SaveChangesAsync();
    }

    public WebApplicationFactory<Program> CreateFactory(string environment = "Development")
        => new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder
            .UseEnvironment(environment)
            .UseSetting("ConnectionStrings:Database", ApplicationConnection)
            // Large integration suites authenticate a registrar and an actor for each isolated scenario.
            // The dedicated limiter test overrides this to 1; production settings are unaffected.
            .UseSetting("Security:AccountPermitLimit", "2000"));

    public async Task<HttpClient> ClientAsync(string? user = "anna", Guid? tenantId = null)
    {
        var client = Factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        if (user is not null)
        {
            await RefreshCsrfAsync(client);
            var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = $"{user}@example.test", password = Password });
            login.EnsureSuccessStatusCode();
            await RefreshCsrfAsync(client);
        }
        if (tenantId is not null) client.DefaultRequestHeaders.Add("X-Tenant-Id", tenantId.ToString());
        return client;
    }

    internal async Task<HttpResponseMessage> RegisterAsync(object input, WebApplicationFactory<Program>? factory = null)
    {
        using var registrar = (factory ?? Factory).CreateClient(new() { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        await SignInAsync(registrar, "test.registrar");
        return await registrar.PostAsJsonAsync("/api/v1/auth/register", input);
    }

    internal static async Task SignInAsync(HttpClient client, string userName)
    {
        await RefreshCsrfAsync(client);
        (await client.PostAsJsonAsync("/api/v1/auth/login", new { userName, password = Password })).EnsureSuccessStatusCode();
        await RefreshCsrfAsync(client);
    }

    public static async Task RefreshCsrfAsync(HttpClient client)
    {
        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/api/v1/auth/csrf");
        client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf!.RequestToken);
    }

    private sealed record CsrfResponse(string RequestToken);

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
