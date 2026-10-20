using System.ComponentModel;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Hermes.ControlCenter.Core;

namespace Hermes.ControlCenter;

public sealed record ServiceRow(ServiceKind Kind, string Name, string Address, string State, Brush Color,
    string Pids, string Detail, string Version, string Latency, string Resources, bool CanRestart)
{
    public string RestartLabel => Name + " újraindítása";
}

public sealed record ProcessRow(string Service, string Name, int Id, int ParentId, string Memory, string Cpu, string Uptime, string Executable);

public sealed class ObservableRow<T>(T data) : INotifyPropertyChanged
{
    public T Data { get; private set; } = data;
    public event PropertyChangedEventHandler? PropertyChanged;
    public void Update(T value) { Data = value; PropertyChanged?.Invoke(this, new(nameof(Data))); }
}

public partial class MainWindow : Window
{
    private readonly string root;
    private readonly ControlCenterSettings settings;
    private readonly EventJournal journal;
    private readonly GitVersionService git;
    private readonly WindowsProcessInspector inspector;
    private readonly HealthMonitor health;
    private readonly ServiceController controller;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(4) };
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(5) };
    private bool refreshing;
    private bool checkingGit;
    private bool operating;
    private bool closed;
    private DateTimeOffset lastGitAttempt = DateTimeOffset.MinValue;
    private GitSnapshot? gitSnapshot;
    private string? operationResult;
    private readonly ObservableCollection<ObservableRow<ServiceRow>> serviceRows = [];
    private readonly ObservableCollection<ObservableRow<ProcessRow>> processRows = [];

    public MainWindow(string root, ControlCenterSettings settings)
    {
        this.root = root;
        this.settings = settings;
        var runner = new CommandRunner();
        journal = new(root);
        git = new(root, settings.GitPath, runner);
        inspector = new(root, settings, runner);
        health = new(root, settings, http);
        controller = new(root, settings, runner, inspector, health, journal, Environment.ProcessPath!);
        InitializeComponent();
        ServiceList.ItemsSource = serviceRows;
        ProcessGrid.ItemsSource = processRows;
        RootLabel.Text = root;
        RootLabel.ToolTip = root;
        journal.Added += JournalAdded;
        journal.Write("Vezérlő", "A vezérlő megnyílt. Bezárása után a szolgáltatások tovább futnak.");
        timer.Tick += async (_, _) =>
        {
            await RefreshAsync();
            if (DateTimeOffset.Now - lastGitAttempt > TimeSpan.FromMinutes(1)) await RefreshGitAsync();
        };
        Loaded += async (_, _) => { timer.Start(); await RefreshAsync(); await RefreshGitAsync(); };
        Closing += OnClosing;
        Closed += (_, _) => { closed = true; timer.Stop(); journal.Added -= JournalAdded; http.Dispose(); };
    }

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (!operating) return;
        e.Cancel = true;
        OperationStatus.Text = "Az újraindítás még folyamatban van. A befejezés után bezárhatod a vezérlőt.";
    }

    private void JournalAdded(JournalEntry entry)
    {
        Dispatcher.InvokeAsync(() =>
        {
            if (closed) return;
            EventsText.Text = string.Join(Environment.NewLine, journal.Snapshot().Select(item => $"{item.Time:HH:mm:ss} [{item.Source}] {item.Message}"));
            EventsText.ScrollToEnd();
            if (operating) OperationStatus.Text = $"{entry.Source}: {entry.Message.Split('\n')[0]}";
        });
    }

    private async Task RefreshGitAsync()
    {
        if (checkingGit || closed) return;
        checkingGit = true;
        GitButton.IsEnabled = false;
        lastGitAttempt = DateTimeOffset.Now;
        try
        {
            gitSnapshot = await git.RefreshAsync(fetch: true);
            LocalVersion.Text = $"{gitSnapshot.Local.Short} · {gitSnapshot.Branch}{(gitSnapshot.Dirty ? " · módosítva" : "")}";
            LocalVersion.ToolTip = gitSnapshot.Local.Sha;
            LocalSubject.Text = gitSnapshot.Local.Subject;
            RemoteVersion.Text = gitSnapshot.Remote is null ? "Nincs követett távoli ág" : $"{gitSnapshot.Remote.Short} · {gitSnapshot.Upstream}";
            RemoteVersion.ToolTip = gitSnapshot.Remote?.Sha;
            RemoteSubject.Text = gitSnapshot.Remote?.Subject ?? "Állíts be upstream ágat a Gitben.";
            Comparison.Text = gitSnapshot.Comparison;
            GitFreshness.Text = gitSnapshot.Error ?? (gitSnapshot.LastVerified is { } time ? $"GitHub ellenőrizve: {time:yyyy.MM.dd. HH:mm:ss}" : "A távoli állapot nincs frissen ellenőrizve.");
            GitFreshness.Foreground = gitSnapshot.Error is null ? Brushes.SlateGray : Brushes.DarkOrange;
            if (gitSnapshot.Error is not null) journal.Write("Git", gitSnapshot.Error);
        }
        catch (Exception exception)
        {
            GitFreshness.Text = "Git-ellenőrzési hiba; a megjelenített verzió elavult lehet.";
            journal.Write("Git", exception.Message);
        }
        finally { checkingGit = false; if (!closed) GitButton.IsEnabled = true; }
    }

    private async Task RefreshAsync()
    {
        if (refreshing || closed) return;
        refreshing = true;
        try
        {
            var healthTask = health.ReadAsync();
            IReadOnlyList<FleetProcess> processes;
            string? processError = null;
            try { processes = await inspector.ReadAsync(); }
            catch (Exception exception) { processes = []; processError = exception.Message; }
            var snapshot = await healthTask;
            if (closed) return;
            var rows = new List<ServiceRow>();
            var currentProcesses = new List<ProcessRow>();
            foreach (var kind in new[] { ServiceKind.Backend, ServiceKind.Frontend, ServiceKind.Database })
            {
                var family = ProcessOwnership.Family(processes, kind, root, settings);
                var probe = kind switch { ServiceKind.Backend => snapshot.BackendReady, ServiceKind.Frontend => snapshot.Frontend, _ => snapshot.Database };
                var isHealthy = kind == ServiceKind.Backend ? snapshot.BackendHealthy : probe.Healthy;
                var state = isHealthy ? family.Count > 0 ? "Működik" : "Elérhető · külső" : family.Count > 0 ? "Fut · hibás health" : "Nem érhető el";
                var version = kind == ServiceKind.Backend ? BackendVersion(snapshot.BackendVersion)
                    : kind == ServiceKind.Frontend ? FrontendVersion(family) : "PostgreSQL · hitelesített alkalmazáskapcsolat";
                var detail = kind == ServiceKind.Backend ? $"Live: {snapshot.BackendLive.Detail} · Ready: {probe.Detail}" : probe.Detail;
                rows.Add(new(kind, ServiceName(kind), kind switch { ServiceKind.Backend => settings.BackendUrl, ServiceKind.Frontend => settings.FrontendUrl, _ => $"127.0.0.1:{settings.DatabasePort} / hermes" },
                    processError is null ? state : "Folyamatadat ismeretlen", isHealthy ? Brushes.SeaGreen : Brushes.Firebrick,
                    family.Count > 0 ? "PID " + string.Join(", ", family.Where(process => ProcessOwnership.IsMain(process, kind, root, settings)).Select(process => process.Id)) : "Nincs azonosított saját PID",
                    detail, version, $"{probe.Milliseconds} ms", $"{family.Sum(process => process.MemoryMb):N0} MB · {family.Count} folyamat", !operating));
                currentProcesses.AddRange(family.Select(process => Row(ServiceName(kind), process)));
            }
            currentProcesses.AddRange(processes.Where(process => process.Name.Equals("Hermes.ControlCenter.exe", StringComparison.OrdinalIgnoreCase))
                .Select(process => Row(process.CommandLine.Contains("--service-host", StringComparison.Ordinal) ? "Szolgáltatásgazda" : "Vezérlő", process)));
            foreach (var row in rows)
            {
                var existing = serviceRows.FirstOrDefault(item => item.Data.Kind == row.Kind);
                if (existing is null) serviceRows.Add(new(row)); else existing.Update(row);
            }
            foreach (var old in processRows.Where(item => currentProcesses.All(process => process.Id != item.Data.Id)).ToArray()) processRows.Remove(old);
            foreach (var row in currentProcesses)
            {
                var existing = processRows.FirstOrDefault(item => item.Data.Id == row.Id);
                if (existing is null) processRows.Add(new(row)); else existing.Update(row);
            }
            LastChecked.Text = $"Ellenőrizve: {DateTimeOffset.Now:HH:mm:ss} · Automatikus health: 5 mp · GitHub: 60 mp · Az ablak bezárása nem állítja le a szolgáltatásokat.";
            if (!operating) OperationStatus.Text = processError ?? operationResult ?? "A teljes újraindítás sorrendje: PostgreSQL → backend → frontend. Az adatbázis-újraindítás röviden megszakítja a kapcsolatokat.";
            RefreshLog();
        }
        catch (Exception exception)
        {
            if (!closed) { LastChecked.Text = "Az állapotfrissítés nem sikerült; a korábbi adatok elavultak lehetnek."; journal.Write("Health", exception.Message); }
        }
        finally { refreshing = false; }
    }

    private string BackendVersion(RuntimeVersion? version)
    {
        if (version is null) return "Futó build: nem olvasható (leállt vagy korábbi backend).";
        var hash = Short(version.Commit);
        var dirty = version.Dirty switch { true => " · módosított forrás", null => " · forrásállapot nincs rögzítve", _ => "" };
        var comparison = gitSnapshot is not null && version.Commit != gitSnapshot.Local.Sha ? " · eltér a helyi HEAD-től" : "";
        return $"Futó build: {hash}{dirty}{comparison} · {version.Environment}";
    }

    private string FrontendVersion(IReadOnlyList<FleetProcess> processes)
    {
        try
        {
            var path = ServiceHost.StampPath(root, ServiceKind.Frontend);
            var stamp = File.Exists(path) ? JsonSerializer.Deserialize<ServiceStamp>(File.ReadAllText(path)) : null;
            if (stamp is not null && processes.Any(process => process.Id == stamp.ProcessId && Math.Abs((process.StartedAt - stamp.StartedAt).TotalSeconds) < 1))
                return $"Vite · induló forrás: {Short(stamp.Commit)}{(stamp.Dirty ? " (módosítva)" : "")} · a munkafát élőben követi";
        }
        catch (Exception exception) when (exception is IOException or JsonException) { }
        return "Vite · élő munkafa; az induló commit nincs rögzítve";
    }

    private static string Short(string? hash) => hash is { Length: >= 8 } ? hash[..8] : hash ?? "ismeretlen";
    private static string ServiceName(ServiceKind kind) => kind switch { ServiceKind.Database => "PostgreSQL", ServiceKind.Backend => ".NET backend", _ => "React frontend" };
    private static ProcessRow Row(string service, FleetProcess process) => new(service, process.Name, process.Id, process.ParentId,
        $"{process.MemoryMb:N1} MB", $"{process.CpuPercent:N1}%", (DateTimeOffset.Now - process.StartedAt).ToString(@"d\.hh\:mm\:ss"), process.Executable);

    private async Task Operate(Func<Task> operation)
    {
        if (operating) return;
        operating = true;
        operationResult = null;
        OperationStatus.Foreground = Brushes.DarkSlateGray;
        ActionButtons.IsEnabled = false;
        ServiceList.IsEnabled = false;
        OperationProgress.Visibility = Visibility.Visible;
        try { await operation(); operationResult = "Az újraindítás befejeződött; a health ellenőrzések sikeresek."; }
        catch (Exception exception) { journal.Write("Hiba", exception.Message); operationResult = "Nem sikerült: " + journal.Redact(exception.Message); OperationStatus.Foreground = Brushes.Firebrick; }
        finally
        {
            operating = false;
            ActionButtons.IsEnabled = true;
            ServiceList.IsEnabled = true;
            OperationProgress.Visibility = Visibility.Collapsed;
            OperationStatus.Text = operationResult;
            await RefreshAsync();
            await RefreshGitAsync();
        }
    }

    private void RefreshLog()
    {
        if (ServiceLog is null || LogSelector?.SelectedItem is not ComboBoxItem item) return;
        var path = Path.Combine(root, ".local", "control-center", "logs", (string)item.Content + ".log");
        try
        {
            var text = "Ehhez a szolgáltatáshoz még nincs rögzített napló. A vezérlőből történő újraindítástól kezdve jelennek meg itt a sorok.";
            if (File.Exists(path))
            {
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var reader = new StreamReader(stream);
                text = string.Join(Environment.NewLine, reader.ReadToEnd().Split('\n').TakeLast(150));
            }
            ServiceLog.Text = journal.Redact(text);
            ServiceLog.ScrollToEnd();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { ServiceLog.Text = "A napló pillanatnyilag nem olvasható."; }
    }

    private async void RestartService(object sender, RoutedEventArgs e) { if (((Button)sender).Tag is ServiceKind kind) await Operate(() => controller.RestartAsync(kind)); }
    private async void RestartAll(object sender, RoutedEventArgs e) => await Operate(controller.RestartAllAsync);
    private async void RefreshClicked(object sender, RoutedEventArgs e) => await RefreshAsync();
    private async void CheckGit(object sender, RoutedEventArgs e) => await RefreshGitAsync();
    private void LogSelectionChanged(object sender, SelectionChangedEventArgs e) { if (IsInitialized) RefreshLog(); }
    private void OpenFrontend(object sender, RoutedEventArgs e) => Open(settings.FrontendUrl);
    private void OpenLogs(object sender, RoutedEventArgs e) => Open(Path.Combine(root, ".local", "control-center", "logs"));
    private void OpenSettings(object sender, RoutedEventArgs e)
    {
        try { var info = new ProcessStartInfo("notepad.exe") { UseShellExecute = false }; info.ArgumentList.Add(ControlCenterSettings.SettingsPath(root)); Process.Start(info)?.Dispose(); }
        catch (Exception exception) { journal.Write("Beállítások", exception.Message); }
    }
    private void Open(string target)
    {
        try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true })?.Dispose(); }
        catch (Exception exception) { journal.Write("Megnyitás", exception.Message); }
    }
}
