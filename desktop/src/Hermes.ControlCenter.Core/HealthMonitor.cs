using System.Diagnostics;
using System.Net.Http.Json;
using Npgsql;

namespace Hermes.ControlCenter.Core;

public sealed record Probe(bool Healthy, string Detail, long Milliseconds);
public sealed record RuntimeVersion(string Service, string Version, string? Commit, bool? Dirty, DateTimeOffset StartedAt,
    string Environment, int ProcessId, string? BuiltAt);
public sealed record HealthSnapshot(Probe BackendLive, Probe BackendReady, Probe Frontend, Probe Database, RuntimeVersion? BackendVersion)
{
    public bool BackendHealthy => BackendLive.Healthy && BackendReady.Healthy;
}

public sealed class HealthMonitor(string root, ControlCenterSettings settings, HttpClient client)
{
    public async Task<HealthSnapshot> ReadAsync()
    {
        var live = ProbeHttp(settings.BackendUrl + "/health/live", "ok");
        var ready = ProbeHttp(settings.BackendUrl + "/health/ready", "ready");
        var frontend = ProbeHttp(settings.FrontendUrl + "/", null);
        var database = ProbeDatabase();
        var version = ReadVersion();
        await Task.WhenAll(live, ready, frontend, database, version);
        return new(await live, await ready, await frontend, await database, await version);
    }

    private async Task<Probe> ProbeHttp(string url, string? expectedStatus)
    {
        var watch = Stopwatch.StartNew();
        try
        {
            using var response = await client.GetAsync(url);
            if (!response.IsSuccessStatusCode) return new(false, $"HTTP {(int)response.StatusCode}", watch.ElapsedMilliseconds);
            if (expectedStatus is not null)
            {
                var body = await response.Content.ReadFromJsonAsync<Dictionary<string, string>>();
                return new(body?.GetValueOrDefault("status") == expectedStatus, $"HTTP {(int)response.StatusCode} · {body?.GetValueOrDefault("status") ?? "ismeretlen válasz"}", watch.ElapsedMilliseconds);
            }
            var html = await response.Content.ReadAsStringAsync();
            var hermes = html.Contains("HERMES", StringComparison.OrdinalIgnoreCase) && html.Contains("<html", StringComparison.OrdinalIgnoreCase);
            return new(hermes, hermes ? "HTTP 200 · HERMES felület" : "HTTP 200 · nem HERMES oldal", watch.ElapsedMilliseconds);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or NotSupportedException)
        { return new(false, "Nem érhető el / hibás válasz", watch.ElapsedMilliseconds); }
    }

    private async Task<RuntimeVersion?> ReadVersion()
    {
        try
        {
            var version = await client.GetFromJsonAsync<RuntimeVersion>(settings.BackendUrl + "/health/version");
            return version?.Service == "Hermes.Api" ? version : null;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or NotSupportedException) { return null; }
    }

    public static string ConnectionString(string root, ControlCenterSettings settings, bool monitoring = true)
    {
        var environment = ControlCenterSettings.ReadEnvironment(root);
        if (!environment.TryGetValue("POSTGRES_APP_PASSWORD", out var password) || string.IsNullOrWhiteSpace(password))
            throw new InvalidOperationException("A .env fájlban nincs alkalmazás-adatbázisjelszó.");
        return new NpgsqlConnectionStringBuilder
        {
            Host = "127.0.0.1", Port = settings.DatabasePort, Database = "hermes", Username = "hermes_app",
            Password = password, Timeout = monitoring ? 3 : 15, CommandTimeout = monitoring ? 3 : 30,
            Pooling = !monitoring, ApplicationName = monitoring ? "Hermes.ControlCenter" : "Hermes.Api"
        }.ConnectionString;
    }

    private async Task<Probe> ProbeDatabase()
    {
        var watch = Stopwatch.StartNew();
        try
        {
            await using var connection = new NpgsqlConnection(ConnectionString(root, settings));
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand("SELECT 1", connection);
            var result = await command.ExecuteScalarAsync();
            return new(Equals(result, 1), "SQL kapcsolat · SELECT 1", watch.ElapsedMilliseconds);
        }
        catch (Exception exception) when (exception is NpgsqlException or InvalidOperationException or TimeoutException or IOException)
        { return new(false, "Az SQL-kapcsolat nem működik; ellenőrizd a portot és a .env fájlt.", watch.ElapsedMilliseconds); }
    }
}
