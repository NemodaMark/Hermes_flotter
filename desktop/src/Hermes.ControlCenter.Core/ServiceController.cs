using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;

namespace Hermes.ControlCenter.Core;

public sealed class ServiceController(string root, ControlCenterSettings settings, ICommandRunner runner,
    IProcessInspector inspector, HealthMonitor health, EventJournal journal, string hostExecutable)
{
    public async Task RestartAsync(ServiceKind kind)
    {
        journal.Write(kind.ToString(), "Újraindítás megkezdve.");
        if (kind == ServiceKind.Database) await RestartDatabase();
        else
        {
            foreach (var process in (await inspector.ReadAsync()).Where(process => ProcessOwnership.IsMain(process, kind, root, settings)))
                await StopVerified(process, kind);
            await PortAvailability.WaitAsync(kind == ServiceKind.Backend ? settings.BackendPort : settings.FrontendPort, TimeSpan.FromSeconds(8));
            if (kind == ServiceKind.Backend)
            {
                journal.Write("Backend", "Fordítás folyamatban…");
                var dirty = await runner.RunAsync(new(settings.GitPath, ["status", "--porcelain"], root), TimeSpan.FromSeconds(10));
                if (dirty.ExitCode != 0) throw new InvalidOperationException("A fordításhoz nem olvasható a Git-állapot.");
                var result = await runner.RunAsync(new(settings.DotnetPath,
                    ["build", Path.Combine(root, "backend", "src", "Hermes.Api", "Hermes.Api.csproj"), "-c", "Debug", "--nologo", $"-p:BuildDirty={!string.IsNullOrWhiteSpace(dirty.Output)}"], root, DotnetEnvironment()), TimeSpan.FromMinutes(3));
                journal.Write("Backend", result.Output);
                if (result.ExitCode != 0)
                {
                    journal.Write("Backend", result.Error);
                    throw new InvalidOperationException("A backend fordítása nem sikerült. Részletek az eseménynaplóban.");
                }
            }
            StartHost(kind);
        }
        journal.Write(kind.ToString(), "Indítás után a tényleges elérhetőség ellenőrzése…");
        var deadline = DateTimeOffset.UtcNow.AddSeconds(60);
        while (DateTimeOffset.UtcNow < deadline)
        {
            var snapshot = await health.ReadAsync();
            if (kind switch { ServiceKind.Backend => snapshot.BackendHealthy, ServiceKind.Frontend => snapshot.Frontend.Healthy, _ => snapshot.Database.Healthy })
            { journal.Write(kind.ToString(), "Újraindítás kész; a health ellenőrzés sikeres."); return; }
            await Task.Delay(1000);
        }
        throw new TimeoutException("A szolgáltatás nem vált elérhetővé 60 másodperc alatt. Ellenőrizd a naplóját.");
    }

    public async Task RestartAllAsync()
    {
        // Dependency order; a database failure leaves the other services running for diagnostics.
        await RestartAsync(ServiceKind.Database);
        await RestartAsync(ServiceKind.Backend);
        await RestartAsync(ServiceKind.Frontend);
    }

    private async Task StopVerified(FleetProcess candidate, ServiceKind kind)
    {
        var fresh = (await inspector.ReadAsync()).SingleOrDefault(process => process.Id == candidate.Id);
        if (fresh is null) return;
        if (fresh.StartedAt != candidate.StartedAt || !ProcessOwnership.IsMain(fresh, kind, root, settings))
            throw new InvalidOperationException("A folyamat az ellenőrzés óta megváltozott; nem állítottam le.");
        using var process = Process.GetProcessById(fresh.Id);
        if (Math.Abs((process.StartTime.ToUniversalTime() - fresh.StartedAt.UtcDateTime).TotalSeconds) > 1)
            throw new InvalidOperationException("A folyamatazonosító már másik folyamathoz tartozik.");
        journal.Write(kind.ToString(), $"Saját folyamat leállítása: PID {fresh.Id}.");
        process.Kill(); // Never kill by executable name or kill an unrelated ancestor process tree.
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(12));
        await process.WaitForExitAsync(deadline.Token);
    }

    public Dictionary<string, string> DotnetEnvironment()
    {
        var environment = new Dictionary<string, string>();
        if (Path.IsPathFullyQualified(settings.DotnetPath))
        {
            environment["DOTNET_ROOT"] = Path.GetDirectoryName(settings.DotnetPath)!;
            environment["PATH"] = environment["DOTNET_ROOT"] + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
        }
        return environment;
    }

    private void StartHost(ServiceKind kind)
    {
        if (kind == ServiceKind.Frontend && !File.Exists(Path.Combine(root, "frontend", "node_modules", "vite", "bin", "vite.js")))
            throw new InvalidOperationException("Hiányzik a frontend függősége. Futtasd az npm ci parancsot a frontend mappában.");
        var command = new Command(hostExecutable, ["--service-host", kind.ToString(), "--root", root], root, DotnetEnvironment(), CaptureOutput: false);
        var info = CommandRunner.StartInfo(command);
        using var host = Process.Start(info) ?? throw new InvalidOperationException("Nem indult el a szolgáltatásgazda.");
        journal.Write(kind.ToString(), $"Háttérben futó szolgáltatásgazda indult: PID {host.Id}.");
    }

    private async Task RestartDatabase()
    {
        var executable = Path.Combine(settings.PostgresBin, "pg_ctl.exe");
        if (!File.Exists(executable) || !File.Exists(Path.Combine(settings.PostgresData, "PG_VERSION")))
            throw new InvalidOperationException("Állítsd be a helyi PostgreSQL bin- és adatmappáját a vezérlő settings.json fájljában. A vezérlő nem állít le idegen vagy Docker-adatbázist.");
        if (await inspector.IsDatabaseServiceAsync())
            throw new InvalidOperationException("Ezt a PostgreSQL-telepítést Windows-szolgáltatás kezeli. A natív fejlesztői vezérlő nem indítja újra a szolgáltatáskezelő megkerülésével.");
        var status = await runner.RunAsync(new(executable, ["status", "-D", settings.PostgresData], root), TimeSpan.FromSeconds(10));
        if (status.ExitCode is not (0 or 3)) throw new InvalidOperationException("A PostgreSQL-adatmappa állapota nem ellenőrizhető.");
        var mode = status.ExitCode == 0 ? "restart" : "start";
        var log = Path.Combine(root, ".local", "control-center", "logs", "Database.log");
        journal.Write("Database", mode == "restart" ? "Szabályos PostgreSQL-újraindítás (fast mód)." : "PostgreSQL indítása.");
        var arguments = new List<string> { mode, "-D", settings.PostgresData, "-l", log, "-w", "-t", "35", "-o", $"-p {settings.DatabasePort} -h 127.0.0.1" };
        if (mode == "restart") arguments.AddRange(["-m", "fast"]);
        // A detached PostgreSQL child can inherit redirected pipe handles on Windows.
        // pg_ctl writes server output to -l; wait on its exit code without capturing those pipes.
        var result = await runner.RunAsync(new(executable, arguments, root, CaptureOutput: false), TimeSpan.FromSeconds(45));
        if (result.ExitCode != 0)
        {
            journal.Write("Database", result.Output + result.Error);
            throw new InvalidOperationException("A PostgreSQL indítása nem sikerült; részletek az adatbázis naplójában.");
        }
    }

}

public static class PortAvailability
{
    public static async Task WaitAsync(int port, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        do
        {
            var listener = new TcpListener(IPAddress.Loopback, port);
            try { listener.Start(); return; }
            catch (SocketException) { }
            finally { listener.Stop(); }
            await Task.Delay(100);
        } while (DateTimeOffset.UtcNow < deadline);
        throw new InvalidOperationException($"A(z) {port} port továbbra is foglalt. Az azt használó, nem azonosított folyamatot nem állítom le.");
    }
}

public sealed record ServiceStamp(int ProcessId, DateTimeOffset StartedAt, string Commit, bool Dirty);

public static class ServiceHost
{
    public static string StampPath(string root, ServiceKind kind) => Path.Combine(root, ".local", "control-center", $"{kind}.json");

    public static async Task<int> RunAsync(string root, ControlCenterSettings settings, ServiceKind kind)
    {
        var journal = new EventJournal(root);
        var logPath = Path.Combine(root, ".local", "control-center", "logs", kind + ".log");
        using var logGate = new SemaphoreSlim(1);
        async Task Log(string text)
        {
            await logGate.WaitAsync();
            try
            {
                if (File.Exists(logPath) && new FileInfo(logPath).Length > 3_000_000) File.Move(logPath, logPath + ".previous", overwrite: true);
                await File.AppendAllTextAsync(logPath, $"{DateTimeOffset.Now:HH:mm:ss} {journal.Redact(text)}{Environment.NewLine}");
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { /* Logging must not stop the hosted service. */ }
            finally { logGate.Release(); }
        }
        try
        {
            var environment = new Dictionary<string, string> { ["NO_COLOR"] = "1", ["TERM"] = "dumb" };
            Command command;
            if (kind == ServiceKind.Backend)
            {
                environment["ASPNETCORE_ENVIRONMENT"] = "Development";
                environment["ASPNETCORE_URLS"] = settings.BackendUrl;
                environment["ConnectionStrings__Database"] = HealthMonitor.ConnectionString(root, settings, monitoring: false);
                if (Path.IsPathFullyQualified(settings.DotnetPath)) environment["DOTNET_ROOT"] = Path.GetDirectoryName(settings.DotnetPath)!;
                command = new(settings.DotnetPath, [Path.Combine(root, "backend", "src", "Hermes.Api", "bin", "Debug", "net10.0", "Hermes.Api.dll")], Path.Combine(root, "backend", "src", "Hermes.Api"), environment);
            }
            else if (kind == ServiceKind.Frontend)
            {
                environment["API_PROXY_TARGET"] = settings.BackendUrl;
                command = new(settings.NodePath, [Path.Combine(root, "frontend", "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", settings.FrontendPort.ToString(), "--strictPort"], Path.Combine(root, "frontend"), environment);
            }
            else throw new InvalidOperationException("A PostgreSQL-t a pg_ctl vezérli.");
            var git = await new GitVersionService(root, settings.GitPath, new CommandRunner()).RefreshAsync(false);
            using var process = Process.Start(CommandRunner.StartInfo(command)) ?? throw new InvalidOperationException("Nem indult el a szolgáltatás.");
            var stamp = new ServiceStamp(process.Id, process.StartTime.ToUniversalTime(), git.Local.Sha, git.Dirty);
            await File.WriteAllTextAsync(StampPath(root, kind), JsonSerializer.Serialize(stamp));
            await Log($"{kind} indult · PID {process.Id} · forrás {git.Local.Short}{(git.Dirty ? " (módosított munkafa)" : "")}");
            async Task Drain(StreamReader reader) { while (await reader.ReadLineAsync() is { } line) await Log(line); }
            var output = Drain(process.StandardOutput);
            var error = Drain(process.StandardError);
            await process.WaitForExitAsync();
            await Task.WhenAll(output, error);
            await Log($"A folyamat kilépett: {process.ExitCode}.");
            return process.ExitCode;
        }
        catch (Exception exception)
        {
            await Log("Indítási hiba: " + exception.Message);
            return 1;
        }
    }
}
