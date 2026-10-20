using System.Text.RegularExpressions;

namespace Hermes.ControlCenter.Core;

public sealed record JournalEntry(DateTimeOffset Time, string Source, string Message);

public sealed partial class EventJournal
{
    private readonly object sync = new();
    private readonly List<JournalEntry> entries = [];
    private readonly string path;
    private readonly string[] secrets;
    public event Action<JournalEntry>? Added;
    [GeneratedRegex(@"(?i)(password|pwd|token|secret)\s*=\s*(""[^""]*""|'[^']*'|[^;\s]+)")]
    private static partial Regex SensitiveValues();

    public EventJournal(string root)
    {
        var directory = Path.Combine(root, ".local", "control-center", "logs");
        Directory.CreateDirectory(directory);
        path = Path.Combine(directory, "controller.log");
        secrets = ControlCenterSettings.ReadEnvironment(root)
            .Where(pair => pair.Key.Contains("PASSWORD", StringComparison.OrdinalIgnoreCase) || pair.Key.Contains("SECRET", StringComparison.OrdinalIgnoreCase))
            .Select(pair => pair.Value).Where(value => value.Length > 0).OrderByDescending(value => value.Length).ToArray();
    }

    public string Redact(string message)
    {
        foreach (var secret in secrets) message = message.Replace(secret, "[rejtett]", StringComparison.Ordinal);
        return SensitiveValues().Replace(message, "$1=[rejtett]");
    }

    public void Write(string source, string message)
    {
        var entry = new JournalEntry(DateTimeOffset.Now, source, Redact(message));
        lock (sync)
        {
            entries.Add(entry);
            if (entries.Count > 500) entries.RemoveRange(0, entries.Count - 500);
            try
            {
                if (File.Exists(path) && new FileInfo(path).Length > 3_000_000) File.Move(path, path + ".previous", overwrite: true);
                File.AppendAllText(path, $"{entry.Time:O} [{source}] {entry.Message}{Environment.NewLine}");
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { /* A locked log must not interrupt service management. */ }
        }
        Added?.Invoke(entry);
    }

    public JournalEntry[] Snapshot() { lock (sync) return entries.ToArray(); }
}
