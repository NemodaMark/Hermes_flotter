using System.Net;
using System.Net.Sockets;
using Hermes.ControlCenter.Core;
using Xunit;

namespace Hermes.ControlCenter.Tests;

public sealed class ControlCenterTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "hermes-control-tests-" + Guid.NewGuid().ToString("N"));
    public ControlCenterTests() => Directory.CreateDirectory(root);
    public void Dispose() => Directory.Delete(root, recursive: true);
    private FleetProcess Process(int id, string executable, string command, int parent = 0)
        => new(id, parent, Path.GetFileName(executable), executable, command, DateTimeOffset.UtcNow, 10);

    [Fact]
    public void Only_the_exact_project_vite_script_is_owned()
    {
        var vite = Path.Combine(root, "frontend", "node_modules", "vite", "bin", "vite.js");
        Assert.True(ProcessOwnership.IsMain(Process(1, "node.exe", $"node \"{vite}\""), ServiceKind.Frontend, root, new()));
        Assert.False(ProcessOwnership.IsMain(Process(2, "node.exe", "node other-project/vite.js"), ServiceKind.Frontend, root, new()));
        Assert.False(ProcessOwnership.IsMain(Process(3, "node.exe", $"node \"{vite}.malicious\""), ServiceKind.Frontend, root, new()));
    }

    [Fact]
    public void Backend_must_be_inside_this_projects_output_directory()
    {
        var api = Path.Combine(root, "backend", "src", "Hermes.Api", "bin", "Debug", "net10.0", "Hermes.Api.exe");
        Assert.True(ProcessOwnership.IsMain(Process(1, api, api), ServiceKind.Backend, root, new()));
        Assert.False(ProcessOwnership.IsMain(Process(2, Path.Combine(root + "-other", "Hermes.Api.exe"), ""), ServiceKind.Backend, root, new()));
        Assert.False(ProcessOwnership.IsMain(Process(3, Path.Combine(root, "backend", "src", "Hermes.Api", "bin-other", "Hermes.Api.exe"), ""), ServiceKind.Backend, root, new()));
    }

    [Fact]
    public void Database_children_are_included_only_for_the_configured_data_directory()
    {
        var settings = new ControlCenterSettings { PostgresBin = Path.Combine(root, "pg-bin"), PostgresData = Path.Combine(root, "pg-data") };
        var exe = Path.Combine(settings.PostgresBin, "postgres.exe");
        var main = Process(10, exe, $"\"{exe}\" -D \"{settings.PostgresData}\"");
        var child = Process(11, exe, "postgres --forkchild=bgwriter", 10);
        var other = Process(12, exe, $"postgres -D \"{root}-other\"");
        var family = ProcessOwnership.Family([main, child, other], ServiceKind.Database, root, settings);
        Assert.Equal([10, 11], family.Select(item => item.Id));
    }

    [Fact]
    public void A_pg_ctl_started_database_is_identified_from_its_validated_pid_file()
    {
        var settings = new ControlCenterSettings { PostgresBin = root, PostgresData = root, DatabasePort = 55432 };
        var process = Process(123, Path.Combine(root, "postgres.exe"), "postgres.exe -p 55432 -h 127.0.0.1");
        File.WriteAllText(Path.Combine(root, "postmaster.pid"), $"123\n{root}\n{process.StartedAt.ToUnixTimeSeconds()}\n55432\n");
        Assert.True(ProcessOwnership.IsMain(process, ServiceKind.Database, root, settings));
        Assert.False(ProcessOwnership.IsMain(process with { Id = 124 }, ServiceKind.Database, root, settings));
        Assert.False(ProcessOwnership.IsMain(process with { StartedAt = process.StartedAt.AddMinutes(1) }, ServiceKind.Database, root, settings));
        settings.DatabasePort = 5432;
        Assert.False(ProcessOwnership.IsMain(process, ServiceKind.Database, root, settings));
    }

    [Fact]
    public void Settings_reject_shared_or_invalid_ports()
    {
        Assert.Throws<InvalidOperationException>(() => new ControlCenterSettings { DatabasePort = 5080 }.Validate());
        Assert.Throws<InvalidOperationException>(() => new ControlCenterSettings { BackendPort = 0 }.Validate());
    }

    [Fact]
    public void A_stopped_database_keeps_its_previous_port_when_no_pid_file_exists()
    {
        File.WriteAllText(Path.Combine(root, "postmaster.opts"), "postgres.exe \"-D\" \"my-data\" \"-p\" \"55432\"");
        Assert.Equal(55432, ControlCenterSettings.ReadPostgresPort(root));
        File.WriteAllText(Path.Combine(root, "postmaster.pid"), "123\nmy-data\n0\n55433\n");
        Assert.Equal(55433, ControlCenterSettings.ReadPostgresPort(root));
    }

    private sealed class ServiceInspector : IProcessInspector
    {
        public Task<IReadOnlyList<FleetProcess>> ReadAsync() => Task.FromResult<IReadOnlyList<FleetProcess>>([]);
        public Task<bool> IsDatabaseServiceAsync() => Task.FromResult(true);
    }

    [Fact]
    public async Task A_windows_managed_database_is_not_restarted_with_pg_ctl()
    {
        var settings = new ControlCenterSettings { PostgresBin = Path.Combine(root, "bin"), PostgresData = Path.Combine(root, "data") };
        Directory.CreateDirectory(settings.PostgresBin);
        Directory.CreateDirectory(settings.PostgresData);
        File.WriteAllText(Path.Combine(settings.PostgresBin, "pg_ctl.exe"), "test fixture, not executed");
        File.WriteAllText(Path.Combine(settings.PostgresData, "PG_VERSION"), "18");
        var runner = new GitRunner(false);
        using var http = new HttpClient(new BrokenHealthHandler());
        var controller = new ServiceController(root, settings, runner, new ServiceInspector(), new(root, settings, http), new(root), "unused.exe");
        await Assert.ThrowsAsync<InvalidOperationException>(() => controller.RestartAsync(ServiceKind.Database));
        Assert.Empty(runner.Commands);
    }

    [Fact]
    public void Logs_redact_environment_passwords_and_connection_string_secrets()
    {
        File.WriteAllText(Path.Combine(root, ".env"), "POSTGRES_APP_PASSWORD=some-private-value");
        var log = new EventJournal(root);
        var sanitized = log.Redact("some-private-value Password='other secret'; Token=secret-value");
        Assert.DoesNotContain("some-private-value", sanitized);
        Assert.DoesNotContain("other secret", sanitized);
        Assert.DoesNotContain("secret-value", sanitized);
    }

    private sealed class GitRunner(bool failFetch) : ICommandRunner
    {
        public List<Command> Commands { get; } = [];
        public Task<CommandResult> RunAsync(Command command, TimeSpan timeout, CancellationToken cancellationToken = default)
        {
            Commands.Add(command);
            var output = command.Arguments[0] switch
            {
                "show" => new string(command.Arguments[^1] == "HEAD" ? 'a' : 'b', 40) + "\nA commit subject\n2026-10-20T10:00:00+00:00\n",
                "branch" => "main\n", "status" => " M local.cs\n", "rev-parse" => "origin/main\n",
                "config" => "origin\n", "rev-list" => "1\t2\n", _ => ""
            };
            return Task.FromResult(new CommandResult(failFetch && command.Arguments[0] == "fetch" ? 1 : 0, output, ""));
        }
    }

    [Fact]
    public async Task Git_reports_divergence_and_fetches_without_pulling_or_resetting_files()
    {
        var runner = new GitRunner(false);
        var state = await new GitVersionService(root, "git", runner).RefreshAsync(true);
        Assert.Equal(1, state.Ahead);
        Assert.Equal(2, state.Behind);
        Assert.True(state.Dirty);
        Assert.NotNull(state.LastVerified);
        Assert.Contains(runner.Commands, command => command.Arguments[0] == "fetch");
        Assert.DoesNotContain(runner.Commands, command => command.Arguments[0] is "pull" or "reset" or "checkout");
    }

    [Fact]
    public async Task An_offline_remote_is_not_reported_as_verified()
    {
        var state = await new GitVersionService(root, "git", new GitRunner(true)).RefreshAsync(true);
        Assert.Null(state.LastVerified);
        Assert.NotNull(state.Remote);
        Assert.NotNull(state.Error);
    }

    private sealed class BrokenHealthHandler(bool readySucceeds = false) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent(request.RequestUri!.AbsolutePath == "/" ? "<html>Other app</html>"
                : request.RequestUri.AbsolutePath == "/health/ready" && readySucceeds ? "{\"status\":\"ready\"}" : "{\"status\":\"not-ready\"}") });
    }

    [Fact]
    public async Task A_200_response_alone_does_not_mean_the_service_is_healthy()
    {
        using var http = new HttpClient(new BrokenHealthHandler());
        var health = await new HealthMonitor(root, new(), http).ReadAsync();
        Assert.False(health.BackendReady.Healthy);
        Assert.False(health.BackendLive.Healthy);
        Assert.False(health.Frontend.Healthy);
        Assert.False(health.Database.Healthy);
    }

    [Fact]
    public async Task A_backend_requires_both_successful_live_and_ready_probes()
    {
        using var http = new HttpClient(new BrokenHealthHandler(readySucceeds: true));
        var health = await new HealthMonitor(root, new(), http).ReadAsync();
        Assert.True(health.BackendReady.Healthy);
        Assert.False(health.BackendHealthy);
    }

    [Fact]
    public async Task Commands_are_timed_out_instead_of_hanging_the_desktop_app()
    {
        // Both commands run long enough to exercise child-process timeout handling.
        var command = OperatingSystem.IsWindows()
            ? new Command("ping.exe", ["-n", "10", "127.0.0.1"], root)
            : new Command("sleep", ["10"], root);
        await Assert.ThrowsAsync<TimeoutException>(() => new CommandRunner().RunAsync(command, TimeSpan.FromMilliseconds(100)));
    }

    [Fact]
    public async Task Output_inherited_by_a_background_child_is_also_covered_by_the_deadline()
    {
        var command = OperatingSystem.IsWindows()
            ? new Command("cmd.exe", ["/d", "/c", "start /b ping.exe -n 5 127.0.0.1"], Path.GetTempPath())
            : new Command("sh", ["-c", "sleep 4 &"], Path.GetTempPath());
        await Assert.ThrowsAsync<TimeoutException>(() => new CommandRunner().RunAsync(command, TimeSpan.FromMilliseconds(300)));
    }

    [Fact]
    public async Task Restart_waits_for_the_previous_listener_to_release_its_port()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var wait = PortAvailability.WaitAsync(port, TimeSpan.FromSeconds(3));
        await Task.Delay(150);
        Assert.False(wait.IsCompleted);
        listener.Stop();
        await wait;
    }

    [Fact]
    public async Task An_unrelated_occupied_port_is_reported_without_stopping_its_owner()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            await Assert.ThrowsAsync<InvalidOperationException>(() => PortAvailability.WaitAsync(port, TimeSpan.FromMilliseconds(150)));
            using var client = new TcpClient();
            await client.ConnectAsync(IPAddress.Loopback, port);
            Assert.True(client.Connected);
        }
        finally { listener.Stop(); }
    }
}
