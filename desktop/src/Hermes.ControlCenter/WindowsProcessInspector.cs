using System.Diagnostics;
using System.Text.Json;
using Hermes.ControlCenter.Core;

namespace Hermes.ControlCenter;

public sealed class WindowsProcessInspector(string root, ControlCenterSettings settings, ICommandRunner runner) : IProcessInspector
{
    private readonly Dictionary<int, (DateTimeOffset Time, TimeSpan Cpu, DateTimeOffset Started)> samples = [];
    public async Task<bool> IsDatabaseServiceAsync()
    {
        const string script = """
            $ErrorActionPreference = 'Stop'
            $bin = $env:HERMES_CONTROL_PG
            $services = @(Get-CimInstance Win32_Service | Where-Object { $_.PathName -and $_.PathName.IndexOf($bin, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
            ConvertTo-Json -InputObject ($services.Count -gt 0)
            """;
        var result = await runner.RunAsync(new(settings.PowerShellPath, ["-NoProfile", "-NonInteractive", "-Command", script], root,
            new Dictionary<string, string> { ["HERMES_CONTROL_PG"] = settings.PostgresBin }), TimeSpan.FromSeconds(12));
        if (result.ExitCode != 0) throw new InvalidOperationException("A Windows-szolgáltatások állapota nem ellenőrizhető; az adatbázist nem indítom újra.");
        return JsonSerializer.Deserialize<bool>(result.Output);
    }
    public async Task<IReadOnlyList<FleetProcess>> ReadAsync()
    {
        const string script = """
            [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
            $ErrorActionPreference = 'Stop'
            $root = $env:HERMES_CONTROL_ROOT
            $pg = $env:HERMES_CONTROL_PG
            $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'Hermes.Api.exe' OR Name = 'dotnet.exe' OR Name = 'node.exe' OR Name = 'postgres.exe' OR Name = 'Hermes.ControlCenter.exe'" | Where-Object {
                ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) -or
                ($pg -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($pg, [StringComparison]::OrdinalIgnoreCase)) -or
                ($_.CommandLine -and (($_.CommandLine.IndexOf(($root + '\frontend\'), [StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($_.CommandLine.IndexOf(($root + '\backend\'), [StringComparison]::OrdinalIgnoreCase) -ge 0)))
            } | Select-Object @{n='Id';e={$_.ProcessId}}, @{n='ParentId';e={$_.ParentProcessId}}, Name, @{n='Executable';e={$_.ExecutablePath}}, CommandLine, @{n='StartedAt';e={$_.CreationDate.ToUniversalTime().ToString('O')}})
            ConvertTo-Json -InputObject $processes -Compress
            """;
        var result = await runner.RunAsync(new(settings.PowerShellPath, ["-NoProfile", "-NonInteractive", "-Command", script], root,
            new Dictionary<string, string> { ["HERMES_CONTROL_ROOT"] = root, ["HERMES_CONTROL_PG"] = settings.PostgresBin }), TimeSpan.FromSeconds(12));
        if (result.ExitCode != 0) throw new InvalidOperationException("A Windows folyamatlistája nem olvasható.");
        using var document = JsonDocument.Parse(result.Output);
        var list = new List<FleetProcess>();
        foreach (var element in document.RootElement.EnumerateArray())
        {
            var id = element.GetProperty("Id").GetInt32();
            var started = element.GetProperty("StartedAt").GetDateTimeOffset();
            try
            {
                using var process = Process.GetProcessById(id);
                var now = DateTimeOffset.UtcNow;
                var cpu = process.TotalProcessorTime;
                var percent = samples.TryGetValue(id, out var previous) && previous.Started == started
                    ? (cpu - previous.Cpu).TotalSeconds / Math.Max(0.001, (now - previous.Time).TotalSeconds) / Environment.ProcessorCount * 100 : 0;
                samples[id] = (now, cpu, started);
                list.Add(new(id, element.GetProperty("ParentId").GetInt32(), element.GetProperty("Name").GetString() ?? "",
                    element.GetProperty("Executable").GetString() ?? "", element.GetProperty("CommandLine").GetString() ?? "",
                    started, process.WorkingSet64 / 1024d / 1024d, Math.Clamp(percent, 0, 100)));
            }
            catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
        }
        foreach (var id in samples.Keys.Where(id => list.All(process => process.Id != id)).ToArray()) samples.Remove(id);
        return list;
    }
}
