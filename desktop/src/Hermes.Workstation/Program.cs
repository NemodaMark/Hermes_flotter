using System.Diagnostics;
using Hermes.ControlCenter.Core;

try
{
    if (args.Length < 2) throw new ArgumentException("Használat: prepare|admin|import-csv|start|stop|status|desktop <projektmappa>");
    var root = ControlCenterSettings.FindRoot(args[1]);
    if (args is ["prepare", _, var postgres, var dotnet, var node, var git])
    {
        await LocalInstallation.PrepareAsync(root, postgres, dotnet, node, git);
        return 0;
    }

    var installation = LocalInstallation.Open(root);
    if (args is ["import-csv", _, var package, .. var switches])
    {
        await installation.ImportCsvAsync(Path.GetFullPath(package), switches);
        return 0;
    }
    if (args is ["admin", _, var username, var email])
    {
        await installation.CreateAdminAsync(username, email);
        return 0;
    }
    if (args is ["host", _, "Backend" or "Frontend"])
        return await ServiceHost.RunAsync(root, installation.Settings, Enum.Parse<ServiceKind>(args[2]));
    if (args is ["stop", _])
    {
        await installation.StopAsync();
        return 0;
    }

    if (args is not ["desktop" or "start" or "status", _]) throw new ArgumentException("Ismeretlen művelet.");
    var desktop = args[0] == "desktop";
    try
    {
        if (args[0] != "status") await StartAsync(installation);
        var healthy = await ShowStatusAsync(installation);
        if (desktop && !Console.IsInputRedirected)
        {
            Console.WriteLine();
            Console.Write("Enter a bezáráshoz vagy S a HERMES leállításához: ");
            if (string.Equals(Console.ReadLine(), "S", StringComparison.OrdinalIgnoreCase))
                await installation.StopAsync();
        }
        return healthy ? 0 : 1;
    }
    catch (Exception exception) when (desktop && !Console.IsInputRedirected)
    {
        Console.Error.WriteLine(exception.Message);
        Console.Write("Enter a bezáráshoz… ");
        Console.ReadLine();
        return 1;
    }
}
catch (Exception exception)
{
    Console.Error.WriteLine(exception.Message);
    return 1;
}

static async Task StartAsync(LocalInstallation installation)
{
    if (!OperatingSystem.IsLinux())
        throw new InvalidOperationException("Windowson a HERMES Rendszervezérlő indítja a szolgáltatásokat.");
    using var installationLock = installation.AcquireLock();
    await installation.StartDatabaseAsync();
    var settings = installation.Settings;
    // The saved process IDs identify this checkout's web services, even when another HERMES is running locally.
    foreach (var (kind, port) in new[] { (ServiceKind.Backend, settings.BackendPort), (ServiceKind.Frontend, settings.FrontendPort) })
    {
        if (installation.WebProcessIsRunning(kind)) continue;
        await PortAvailability.WaitAsync(port, TimeSpan.FromSeconds(2));
        var host = new Command("setsid",
            ["--fork", "sh", "-c", "exec \"$@\" </dev/null >/dev/null 2>&1", "hermes",
             settings.DotnetPath, typeof(LocalInstallation).Assembly.Location, "host", installation.Root, kind.ToString()],
            installation.Root);
        var result = await new CommandRunner().RunAsync(host, TimeSpan.FromSeconds(10));
        if (result.ExitCode != 0) throw new InvalidOperationException($"A(z) {kind} háttérfolyamat nem indult el. {result.Error}");
    }
    for (var attempt = 0; attempt < 30; attempt++)
    {
        var status = await installation.Health.ReadAsync();
        if (status.BackendHealthy && status.Frontend.Healthy && status.Database.Healthy
            && installation.WebProcessIsRunning(ServiceKind.Backend) && installation.WebProcessIsRunning(ServiceKind.Frontend))
            return;
        await Task.Delay(TimeSpan.FromSeconds(1));
    }
    throw new TimeoutException($"A szolgáltatások indítása nem fejeződött be. Naplók: {installation.LogDirectory}");
}

static async Task<bool> ShowStatusAsync(LocalInstallation installation)
{
    var status = await installation.Health.ReadAsync();
    foreach (var (name, probe) in new[] { ("PostgreSQL", status.Database), ("API /health/live", status.BackendLive),
                 ("API /health/ready", status.BackendReady), ("Frontend", status.Frontend) })
        Console.WriteLine($"{name,-19} {(probe.Healthy ? "OK" : "HIBA"),-5} {probe.Detail}");
    Console.WriteLine(installation.Settings.FrontendUrl);
    Console.WriteLine($"Naplók: {installation.LogDirectory}");
    return status.Database.Healthy && status.BackendHealthy && status.Frontend.Healthy;
}
