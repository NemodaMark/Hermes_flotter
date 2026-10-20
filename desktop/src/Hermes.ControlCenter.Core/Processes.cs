using System.Text.RegularExpressions;

namespace Hermes.ControlCenter.Core;

public enum ServiceKind { Database, Backend, Frontend }
public sealed record FleetProcess(int Id, int ParentId, string Name, string Executable, string CommandLine,
    DateTimeOffset StartedAt, double MemoryMb, double CpuPercent = 0);

public interface IProcessInspector
{
    Task<IReadOnlyList<FleetProcess>> ReadAsync();
    Task<bool> IsDatabaseServiceAsync() => Task.FromResult(false);
}

public static partial class ProcessOwnership
{
    [GeneratedRegex("\"([^\"]*)\"|([^\\s\"]+)")]
    private static partial Regex Tokens();

    public static bool SamePath(string left, string right)
    {
        try { return string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase); }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException) { return false; }
    }

    private static string[] Arguments(string command) => Tokens().Matches(command).Select(match =>
        match.Groups[1].Success ? match.Groups[1].Value : match.Groups[2].Value).ToArray();

    public static bool IsMain(FleetProcess process, ServiceKind kind, string root, ControlCenterSettings settings)
    {
        var arguments = Arguments(process.CommandLine);
        if (kind == ServiceKind.Frontend)
            return Path.GetFileName(process.Executable).Equals("node.exe", StringComparison.OrdinalIgnoreCase)
                && arguments.Any(argument => Path.IsPathFullyQualified(argument)
                    && SamePath(argument, Path.Combine(root, "frontend", "node_modules", "vite", "bin", "vite.js")));
        if (kind == ServiceKind.Database)
        {
            if (string.IsNullOrWhiteSpace(settings.PostgresBin) || string.IsNullOrWhiteSpace(settings.PostgresData)) return false;
            if (!SamePath(process.Executable, Path.Combine(settings.PostgresBin, "postgres.exe"))) return false;
            var index = Array.IndexOf(arguments, "-D");
            if (index >= 0 && index + 1 < arguments.Length) return SamePath(arguments[index + 1], settings.PostgresData);
            // pg_ctl can pass PGDATA through the environment instead of a -D argument.
            // Match its own PID file, data directory, port and start time; never the executable alone.
            try
            {
                var pidFile = Path.Combine(settings.PostgresData, "postmaster.pid");
                if (!File.Exists(pidFile)) return false;
                var lines = File.ReadAllLines(pidFile);
                return lines.Length > 3 && int.TryParse(lines[0], out var pid) && pid == process.Id
                    && SamePath(lines[1], settings.PostgresData)
                    && int.TryParse(lines[3], out var port) && port == settings.DatabasePort
                    && long.TryParse(lines[2], out var started)
                    && Math.Abs((DateTimeOffset.FromUnixTimeSeconds(started) - process.StartedAt).TotalSeconds) < 2;
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentOutOfRangeException) { return false; }
        }
        var apiDirectory = Path.Combine(root, "backend", "src", "Hermes.Api", "bin") + Path.DirectorySeparatorChar;
        bool IsApi(string path, string extension)
        {
            if (!Path.IsPathFullyQualified(path)) return false;
            var full = Path.GetFullPath(path);
            return full.StartsWith(apiDirectory, StringComparison.OrdinalIgnoreCase)
                && Path.GetFileName(full).Equals("Hermes.Api" + extension, StringComparison.OrdinalIgnoreCase);
        }
        return IsApi(process.Executable, ".exe") ||
            (Path.GetFileName(process.Executable).Equals("dotnet.exe", StringComparison.OrdinalIgnoreCase)
                && arguments.Any(argument => IsApi(argument, ".dll")));
    }

    public static IReadOnlyList<FleetProcess> Family(IReadOnlyList<FleetProcess> all, ServiceKind kind, string root, ControlCenterSettings settings)
    {
        var owned = all.Where(process => IsMain(process, kind, root, settings)).ToList();
        if (kind != ServiceKind.Database) return owned;
        var ids = owned.Select(process => process.Id).ToHashSet();
        bool added;
        do
        {
            added = false;
            foreach (var process in all)
                if (!ids.Contains(process.Id) && ids.Contains(process.ParentId)
                    && SamePath(process.Executable, Path.Combine(settings.PostgresBin, "postgres.exe")))
                { ids.Add(process.Id); owned.Add(process); added = true; }
        } while (added);
        return owned;
    }
}
