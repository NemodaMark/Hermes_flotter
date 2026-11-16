using System.Diagnostics;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hermes.ControlCenter.Core;
using Npgsql;

internal sealed class LocalInstallation
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(3) };
    private readonly CommandRunner runner = new();
    private readonly Dictionary<string, string> environment;

    public string Root { get; }
    public ControlCenterSettings Settings { get; }
    public HealthMonitor Health { get; }
    public string LogDirectory => Path.Combine(Root, ".local", "control-center", "logs");
    private static string WorkDirectory(string root) => Path.Combine(root, ".local", "workstation");
    private static string DataDirectory(string root) => Path.Combine(WorkDirectory(root), "postgres");

    private LocalInstallation(string root, ControlCenterSettings settings)
    {
        Root = root;
        Settings = settings;
        environment = ControlCenterSettings.ReadEnvironment(root);
        foreach (var key in new[] { "POSTGRES_ADMIN_PASSWORD", "POSTGRES_MIGRATOR_PASSWORD", "POSTGRES_APP_PASSWORD" })
            if (string.IsNullOrWhiteSpace(environment.GetValueOrDefault(key)))
                throw new InvalidOperationException($"Hiányzó adatbázis-beállítás a .env fájlban ({key}).");
        Health = new(root, settings, Http);
    }

    public static LocalInstallation Open(string root)
    {
        if (!File.Exists(ControlCenterSettings.SettingsPath(root)))
            throw new InvalidOperationException("Futtasd először a munkaállomás-telepítőt.");
        var settings = ControlCenterSettings.Load(root);
        if (!string.Equals(settings.PostgresData, DataDirectory(root),
                OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
            throw new InvalidOperationException("Ehhez a munkafához már másik PostgreSQL-adatmappa van beállítva. Telepíts külön projektmappába.");
        return new(root, settings);
    }

    public static async Task PrepareAsync(string root, string postgres, string dotnet, string node, string git)
    {
        Directory.CreateDirectory(WorkDirectory(root));
        using var installationLock = Lock(root);
        var settingsPath = ControlCenterSettings.SettingsPath(root);
        var envPath = Path.Combine(root, ".env");
        var stagedEnvPath = Path.Combine(WorkDirectory(root), "bootstrap.env");
        if (File.Exists(settingsPath) && !File.Exists(envPath) && File.Exists(stagedEnvPath))
        {
            var stagedSettings = ControlCenterSettings.Load(root);
            if (stagedSettings.PostgresData == DataDirectory(root)) File.Move(stagedEnvPath, envPath);
        }
        if (File.Exists(settingsPath) != File.Exists(envPath))
            throw new InvalidOperationException("A kiválasztott projekt részben kézzel van konfigurálva. Használj külön projektmappát.");
        var existing = File.Exists(settingsPath);
        var settings = existing ? Open(root).Settings : new ControlCenterSettings
        {
            DatabasePort = await FindPortAsync(55432), BackendPort = await FindPortAsync(5080), FrontendPort = await FindPortAsync(5173),
            PostgresData = DataDirectory(root)
        };
        settings.PostgresBin = postgres;
        settings.DotnetPath = dotnet;
        settings.NodePath = node;
        settings.GitPath = git;
        settings.Validate();
        Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
        var config = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
        if (!existing)
        {
            File.Delete(stagedEnvPath);
            WritePrivateFile(stagedEnvPath, $"""
                POSTGRES_ADMIN_PASSWORD={RandomSecret()}
                POSTGRES_MIGRATOR_PASSWORD={RandomSecret()}
                POSTGRES_APP_PASSWORD={RandomSecret()}
                POSTGRES_PORT={settings.DatabasePort}
                API_PORT={settings.BackendPort}
                FRONTEND_PORT={settings.FrontendPort}

                """);
            SaveSettings(settingsPath, config);
            File.Move(stagedEnvPath, envPath);
        }
        else SaveSettings(settingsPath, config);

        var installation = Open(root);
        Console.WriteLine("Helyi PostgreSQL előkészítése…");
        await installation.InitializeClusterAsync();
        var started = await installation.StartDatabaseAsync();
        try
        {
            await installation.InitializeDatabaseAsync();
            await installation.RunMaintenanceAsync(["--migrate"]);
            var appConnection = HealthMonitor.ConnectionString(root, settings);
            await using var application = new NpgsqlConnection(appConnection);
            await application.OpenAsync();
            await using var query = new NpgsqlCommand("SELECT 1", application);
            await query.ExecuteScalarAsync();
        }
        finally
        {
            if (started) await installation.StopDatabaseAsync();
        }
    }

    public FileStream AcquireLock() => Lock(Root);
    private static FileStream Lock(string root) =>
        new(Path.Combine(WorkDirectory(root), "provision.lock"), FileMode.OpenOrCreate, FileAccess.Write, FileShare.None);

    private static string RandomSecret() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

    private static void SaveSettings(string path, string contents)
    {
        var temp = path + ".new";
        File.WriteAllText(temp, contents);
        File.Move(temp, path, overwrite: true);
    }

    private static void WritePrivateFile(string path, string contents)
    {
        var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None };
        if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        using var writer = new StreamWriter(new FileStream(path, options), new UTF8Encoding(false));
        writer.Write(contents);
    }

    private static async Task<int> FindPortAsync(int preferred)
    {
        try
        {
            await PortAvailability.WaitAsync(preferred, TimeSpan.Zero);
            return preferred;
        }
        catch (InvalidOperationException)
        {
            using var socket = new TcpListener(System.Net.IPAddress.Loopback, 0);
            socket.Start();
            return ((System.Net.IPEndPoint)socket.LocalEndpoint).Port;
        }
    }

    private async Task InitializeClusterAsync()
    {
        var version = Path.Combine(Settings.PostgresData, "PG_VERSION");
        if (File.Exists(version))
        {
            if (File.ReadAllText(version).Trim() != "18") throw new InvalidOperationException("A helyi PostgreSQL-adatmappa verziója eltér a 18-astól.");
            return;
        }
        var passwordFile = Path.Combine(WorkDirectory(Root), $"init-{Guid.NewGuid():N}.pw");
        WritePrivateFile(passwordFile, environment["POSTGRES_ADMIN_PASSWORD"] + "\n");
        try
        {
            await RunPostgresAsync("initdb",
                ["-D", Settings.PostgresData, "-U", "postgres", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", passwordFile]);
        }
        finally { File.Delete(passwordFile); }
    }

    public async Task<bool> StartDatabaseAsync()
    {
        var status = await runner.RunAsync(new(PostgresTool("pg_ctl"), ["status", "-D", Settings.PostgresData], Root), TimeSpan.FromSeconds(10));
        if (status.ExitCode == 0)
        {
            if (ControlCenterSettings.ReadPostgresPort(Settings.PostgresData) != Settings.DatabasePort)
                throw new InvalidOperationException("A projekt PostgreSQL-je eltérő porton fut.");
            return false;
        }
        if (status.ExitCode != 3) throw new InvalidOperationException(status.Error);
        await PortAvailability.WaitAsync(Settings.DatabasePort, TimeSpan.FromSeconds(2));
        Directory.CreateDirectory(LogDirectory);
        var options = $"-p {Settings.DatabasePort} -h 127.0.0.1";
        if (!OperatingSystem.IsWindows()) options += " -c unix_socket_directories=";
        await RunPostgresAsync("pg_ctl", ["start", "-D", Settings.PostgresData, "-l", Path.Combine(LogDirectory, "Database.log"),
            "-w", "-t", "35", "-o", options], captureOutput: false);
        return true;
    }

    private Task StopDatabaseAsync() =>
        RunPostgresAsync("pg_ctl", ["stop", "-D", Settings.PostgresData, "-m", "fast", "-w", "-t", "35"]);

    private string PostgresTool(string name) => Path.Combine(Settings.PostgresBin, name + (OperatingSystem.IsWindows() ? ".exe" : ""));

    private async Task RunPostgresAsync(string executable, string[] arguments,
        Dictionary<string, string>? variables = null, bool captureOutput = true)
    {
        var result = await runner.RunAsync(new(PostgresTool(executable), arguments, Root, variables, captureOutput), TimeSpan.FromMinutes(2));
        if (result.ExitCode != 0)
        {
            var details = new EventJournal(Root).Redact(result.Error);
            throw new InvalidOperationException($"A PostgreSQL {executable} művelete sikertelen. {details}\nNaplók: {LogDirectory}");
        }
    }

    private string Connection(string role, string password, string database) => new NpgsqlConnectionStringBuilder
    {
        Host = "127.0.0.1", Port = Settings.DatabasePort, Database = database, Username = role, Password = password,
        Timeout = 10, Pooling = false
    }.ConnectionString;

    private string MigrationConnection => Connection("hermes_migrator", environment["POSTGRES_MIGRATOR_PASSWORD"], "hermes");

    private async Task InitializeDatabaseAsync()
    {
        await using var admin = new NpgsqlConnection(Connection("postgres", environment["POSTGRES_ADMIN_PASSWORD"], "postgres"));
        await admin.OpenAsync();
        await using var check = new NpgsqlCommand("SELECT EXISTS (SELECT FROM pg_database WHERE datname = 'hermes')", admin);
        if (await check.ExecuteScalarAsync() is false)
        {
            await using var create = new NpgsqlCommand("CREATE DATABASE hermes", admin);
            await create.ExecuteNonQueryAsync();
        }
        check.CommandText = "SELECT count(*) FROM pg_roles WHERE rolname IN ('hermes_migrator', 'hermes_app')";
        var roles = (long)(await check.ExecuteScalarAsync())!;
        if (roles == 2) return;
        if (roles != 0) throw new InvalidOperationException("Hiányos PostgreSQL-szerepkörök a projekt adatbázisában.");

        var variables = new Dictionary<string, string>
        {
            ["PGPASSWORD"] = environment["POSTGRES_ADMIN_PASSWORD"],
            ["HERMES_MIGRATOR_PASSWORD"] = environment["POSTGRES_MIGRATOR_PASSWORD"],
            ["HERMES_APP_PASSWORD"] = environment["POSTGRES_APP_PASSWORD"]
        };
        var template = await File.ReadAllTextAsync(Path.Combine(Root, "infra", "postgres", "roles.sql.template"));
        var sql = Path.Combine(WorkDirectory(Root), $"roles-{Guid.NewGuid():N}.sql");
        try
        {
            await File.WriteAllTextAsync(sql, """
                \getenv migrator_password HERMES_MIGRATOR_PASSWORD
                \getenv app_password HERMES_APP_PASSWORD
                \set database hermes
                """ + "\n" + template);
            await RunPostgresAsync("psql", ["-X", "--single-transaction", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1",
                "-p", Settings.DatabasePort.ToString(), "-U", "postgres", "-d", "hermes", "-f", sql], variables);
        }
        finally { File.Delete(sql); }
    }

    public async Task CreateAdminAsync(string username, string email)
    {
        using var installationLock = AcquireLock();
        var started = await StartDatabaseAsync();
        try
        {
            var password = Environment.GetEnvironmentVariable("HERMES_INITIAL_ADMIN_PASSWORD") ?? ReadPassword();
            await RunMaintenanceAsync(["--initialize-system-admin", username, email], password);
            Console.WriteLine($"Az első rendszergazda elkészült ({username}).");
        }
        finally
        {
            if (started) await StopDatabaseAsync();
        }
    }

    private static string ReadPassword()
    {
        if (Console.IsInputRedirected)
            throw new InvalidOperationException("Add meg a HERMES_INITIAL_ADMIN_PASSWORD környezeti változót, vagy futtasd interaktív terminálból.");
        Console.Write("Rendszergazda jelszava: ");
        var password = new StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) break;
            if (key.Key == ConsoleKey.Backspace && password.Length > 0) password.Length--;
            if (!char.IsControl(key.KeyChar)) password.Append(key.KeyChar);
        }
        Console.WriteLine();
        return password.ToString();
    }

    private async Task RunMaintenanceAsync(string[] arguments, string? password = null)
    {
        var apiDirectory = Path.Combine(Root, "backend", "src", "Hermes.Api");
        var variables = new Dictionary<string, string>
        {
            ["ASPNETCORE_ENVIRONMENT"] = "Development",
            ["DOTNET_ENVIRONMENT"] = "Development",
            ["ConnectionStrings__Migrations"] = MigrationConnection
        };
        if (password is not null) variables["HERMES_INITIAL_ADMIN_PASSWORD"] = password;
        var result = await runner.RunAsync(new(Settings.DotnetPath,
            [Path.Combine(apiDirectory, "bin", "Debug", "net10.0", "Hermes.Api.dll"), .. arguments], apiDirectory, variables), TimeSpan.FromMinutes(3));
        if (result.ExitCode != 0)
        {
            var details = new EventJournal(Root).Redact(result.Error + result.Output);
            throw new InvalidOperationException($"A HERMES adatbázis-művelete sikertelen.\n{details}");
        }
    }

    public async Task StopAsync()
    {
        if (!OperatingSystem.IsLinux()) throw new InvalidOperationException("A parancs Linuxon érhető el.");
        using var installationLock = AcquireLock();
        foreach (var kind in new[] { ServiceKind.Frontend, ServiceKind.Backend })
        {
            using var process = FindWebProcess(kind);
            if (process is null) continue;
            process.Kill();
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await process.WaitForExitAsync(deadline.Token);
        }
        var status = await runner.RunAsync(new(PostgresTool("pg_ctl"), ["status", "-D", Settings.PostgresData], Root), TimeSpan.FromSeconds(10));
        if (status.ExitCode == 0) await StopDatabaseAsync();
        else if (status.ExitCode != 3) throw new InvalidOperationException(status.Error);
    }

    public bool WebProcessIsRunning(ServiceKind kind)
    {
        using var process = FindWebProcess(kind);
        return process is not null;
    }

    private Process? FindWebProcess(ServiceKind kind)
    {
        if (!OperatingSystem.IsLinux()) return null;
        Process? process = null;
        try
        {
            var stamp = JsonSerializer.Deserialize<ServiceStamp>(File.ReadAllText(ServiceHost.StampPath(Root, kind)));
            if (stamp is null) return null;
            process = Process.GetProcessById(stamp.ProcessId);
            var entryPoint = kind == ServiceKind.Backend
                ? Path.Combine(Root, "backend", "src", "Hermes.Api", "bin", "Debug", "net10.0", "Hermes.Api.dll")
                : Path.Combine(Root, "frontend", "node_modules", "vite", "bin", "vite.js");
            var commandLine = File.ReadAllText($"/proc/{stamp.ProcessId}/cmdline").Split('\0');
            if (!process.HasExited && Math.Abs((process.StartTime.ToUniversalTime() - stamp.StartedAt.UtcDateTime).TotalSeconds) < 1
                && commandLine.Length > 1 && commandLine[1] == entryPoint)
                return process;
        }
        catch (Exception exception) when (exception is IOException or JsonException or ArgumentException or InvalidOperationException)
        { /* A process may disappear between reading the stamp and inspecting /proc. */ }
        process?.Dispose();
        return null;
    }
}
