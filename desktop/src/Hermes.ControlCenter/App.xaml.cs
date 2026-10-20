using System.Security.Cryptography;
using System.Text;
using System.Windows;
using Hermes.ControlCenter.Core;

namespace Hermes.ControlCenter;

public partial class App : System.Windows.Application
{
    private Mutex? mutex;
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        try
        {
            var rootIndex = Array.IndexOf(e.Args, "--root");
            var root = ControlCenterSettings.FindRoot(rootIndex >= 0 && rootIndex + 1 < e.Args.Length ? e.Args[rootIndex + 1] : null);
            var settings = ControlCenterSettings.Load(root);
            var hostIndex = Array.IndexOf(e.Args, "--service-host");
            if (hostIndex >= 0)
            {
                ShutdownMode = ShutdownMode.OnExplicitShutdown;
                if (hostIndex + 1 >= e.Args.Length || !Enum.TryParse<ServiceKind>(e.Args[hostIndex + 1], out var kind) || kind == ServiceKind.Database)
                    throw new InvalidOperationException("Hibás szolgáltatásgazda-paraméter.");
                Shutdown(await ServiceHost.RunAsync(root, settings, kind));
                return;
            }
            var identity = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(root.ToUpperInvariant())))[..20];
            mutex = new Mutex(true, "Local\\Hermes.ControlCenter." + identity, out var created);
            if (!created) { MessageBox.Show("Ehhez a projekthez már fut a HERMES vezérlő.", "HERMES"); Shutdown(); return; }
            MainWindow = new MainWindow(root, settings);
            MainWindow.Show();
        }
        catch (Exception exception)
        {
            MessageBox.Show(exception.Message, "HERMES indítási hiba", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    protected override void OnExit(ExitEventArgs e) { mutex?.Dispose(); base.OnExit(e); }
}
