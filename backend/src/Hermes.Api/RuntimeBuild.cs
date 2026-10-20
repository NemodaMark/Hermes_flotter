using System.Reflection;

namespace Hermes.Api;

public static class RuntimeBuild
{
    private static readonly DateTimeOffset StartedAt = System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime();
    public static object Describe(string environment)
    {
        var assembly = typeof(RuntimeBuild).Assembly;
        var version = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";
        var commit = version.Contains('+') ? version[(version.IndexOf('+') + 1)..] : null;
        var metadata = assembly.GetCustomAttributes<AssemblyMetadataAttribute>().ToDictionary(value => value.Key, value => value.Value);
        return new
        {
            service = "Hermes.Api", version, commit,
            dirty = bool.TryParse(metadata.GetValueOrDefault("BuildDirty"), out var dirty) ? (bool?)dirty : null,
            startedAt = StartedAt, environment, processId = Environment.ProcessId,
            builtAt = metadata.GetValueOrDefault("BuildTimeUtc")
        };
    }
}
