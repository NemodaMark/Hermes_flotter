using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Hermes.ControlCenter.Core;

public sealed class ControlCenterSettings
{
    public int BackendPort { get; set; } = 5080;
    public int FrontendPort { get; set; } = 5173;
    public int DatabasePort { get; set; } = 5432;
    public string PostgresBin { get; set; } = "";
    public string PostgresData { get; set; } = "";
    public string DotnetPath { get; set; } = "dotnet";
    public string NodePath { get; set; } = "node";
    public string GitPath { get; set; } = "git";
    public string PowerShellPath { get; set; } = "powershell.exe";
    [JsonIgnore] public string BackendUrl => $"http://127.0.0.1:{BackendPort}";
    [JsonIgnore] public string FrontendUrl => $"http://127.0.0.1:{FrontendPort}";

    public static string SettingsPath(string root) => Path.Combine(root, ".local", "control-center", "settings.json");

    public void Validate()
    {
        if (new[] { BackendPort, FrontendPort, DatabasePort }.Any(port => port is < 1 or > 65535)
            || new[] { BackendPort, FrontendPort, DatabasePort }.Distinct().Count() != 3)
            throw new InvalidOperationException("Három különböző, 1–65535 közötti portot adj meg.");
        if (new[] { DotnetPath, NodePath, GitPath, PowerShellPath }.Any(string.IsNullOrWhiteSpace))
            throw new InvalidOperationException("Hiányzó futtatókörnyezet a vezérlő beállításaiban.");
        if (!string.IsNullOrEmpty(PostgresData) && !Path.IsPathFullyQualified(PostgresData))
            throw new InvalidOperationException("A PostgreSQL adatmappája abszolút elérési út legyen.");
        if (!string.IsNullOrEmpty(PostgresBin) && !Path.IsPathFullyQualified(PostgresBin))
            throw new InvalidOperationException("A PostgreSQL bin mappája abszolút elérési út legyen.");
    }

    public static ControlCenterSettings Load(string root)
    {
        var path = SettingsPath(root);
        if (File.Exists(path))
        {
            var saved = JsonSerializer.Deserialize<ControlCenterSettings>(File.ReadAllText(path))
                ?? throw new InvalidOperationException("Üres vezérlőbeállítás.");
            saved.Validate();
            return saved;
        }
        var settings = new ControlCenterSettings();
        var environment = ReadEnvironment(root);
        if (environment.TryGetValue("POSTGRES_PORT", out var port) && int.TryParse(port, out var parsed)) settings.DatabasePort = parsed;
        var tools = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile), ".codex", "tools", "hermes");
        var dotnet = Path.Combine(tools, "dotnet", "dotnet.exe");
        if (File.Exists(dotnet)) settings.DotnetPath = dotnet;
        var postgres = Path.Combine(tools, "postgresql", "pgsql", "bin");
        var data = Path.Combine(tools, "pgdata");
        if (File.Exists(Path.Combine(postgres, "pg_ctl.exe")) && File.Exists(Path.Combine(data, "PG_VERSION")))
        {
            settings.PostgresBin = postgres;
            settings.PostgresData = data;
            if (ReadPostgresPort(data) is { } actualPort) settings.DatabasePort = actualPort;
        }
        settings.Validate();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }));
        return settings;
    }

    public static int? ReadPostgresPort(string data)
    {
        var pidFile = Path.Combine(data, "postmaster.pid");
        if (File.Exists(pidFile) && File.ReadAllLines(pidFile) is { Length: > 3 } lines
            && int.TryParse(lines[3], out var runningPort) && runningPort is > 0 and <= 65535) return runningPort;
        var options = Path.Combine(data, "postmaster.opts");
        if (!File.Exists(options)) return null;
        var match = Regex.Match(File.ReadAllText(options), "(?:^|\\s)\"?-p\"?\\s+\"?(\\d+)\"?");
        return match.Success && int.TryParse(match.Groups[1].Value, out var port) && port is > 0 and <= 65535 ? port : null;
    }

    public static Dictionary<string, string> ReadEnvironment(string root)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var path = Path.Combine(root, ".env");
        if (!File.Exists(path)) return values;
        foreach (var line in File.ReadLines(path))
        {
            var trimmed = line.Trim();
            var index = trimmed.IndexOf('=');
            if (index > 0 && !trimmed.StartsWith('#'))
                values[trimmed[..index].Trim()] = trimmed[(index + 1)..].Trim().Trim('"', '\'');
        }
        return values;
    }

    public static string FindRoot(string? explicitRoot = null)
    {
        foreach (var start in new[] { explicitRoot, System.Environment.CurrentDirectory, AppContext.BaseDirectory })
        {
            if (string.IsNullOrWhiteSpace(start)) continue;
            var current = new DirectoryInfo(Path.GetFullPath(start));
            while (current is not null)
            {
                if (File.Exists(Path.Combine(current.FullName, "backend", "Hermes.slnx"))
                    && File.Exists(Path.Combine(current.FullName, "frontend", "package.json"))) return current.FullName;
                current = current.Parent;
            }
            if (explicitRoot is not null) break;
        }
        throw new InvalidOperationException("Nem található a HERMES projekt. Indítsd a --root <projektmappa> paraméterrel.");
    }
}
