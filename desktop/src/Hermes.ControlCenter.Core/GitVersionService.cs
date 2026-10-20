namespace Hermes.ControlCenter.Core;

public sealed record CommitInfo(string Sha, string Subject, string Date)
{
    public string Short => Sha.Length > 8 ? Sha[..8] : Sha;
}

public sealed record GitSnapshot(string Branch, string? Upstream, CommitInfo Local, CommitInfo? Remote,
    bool Dirty, int Ahead, int Behind, DateTimeOffset? LastVerified, string? Error)
{
    public string Comparison => Remote is null ? "Nincs követett távoli ág"
        : Ahead > 0 && Behind > 0 ? $"Eltérő előzmények: {Ahead} helyi, {Behind} távoli commit"
        : Behind > 0 ? $"{Behind} committal lemaradva"
        : Ahead > 0 ? $"{Ahead} helyi commit még nincs feltöltve" : "A helyi és a távoli commit megegyezik";
}

public sealed class GitVersionService(string root, string git, ICommandRunner runner)
{
    private DateTimeOffset? lastVerified;
    private async Task<CommandResult> Git(params string[] args) => await runner.RunAsync(
        new(git, args, root, new Dictionary<string, string> { ["GIT_TERMINAL_PROMPT"] = "0", ["GCM_INTERACTIVE"] = "never" }), TimeSpan.FromSeconds(25));

    public async Task<GitSnapshot> RefreshAsync(bool fetch)
    {
        var head = await Git("show", "-s", "--format=%H%n%s%n%cI", "HEAD");
        if (head.ExitCode != 0) throw new InvalidOperationException("A helyi Git-verzió nem olvasható.");
        var branch = (await Git("branch", "--show-current")).Output.Trim();
        var status = (await Git("status", "--porcelain")).Output;
        var upstreamResult = await Git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
        var upstream = upstreamResult.ExitCode == 0 ? upstreamResult.Output.Trim() : null;
        string? error = null;
        if (fetch && upstream is not null)
        {
            // Fetch only updates remote references; it never changes the checked-out project files.
            var remoteName = (await Git("config", "--get", $"branch.{branch}.remote")).Output.Trim();
            if (remoteName is not ("" or ".") && !remoteName.StartsWith('-'))
            {
                try
                {
                    var result = await Git("fetch", "--no-tags", remoteName);
                    if (result.ExitCode == 0) lastVerified = DateTimeOffset.Now;
                    else error = "A GitHub nem érhető el vagy a Git-hitelesítés nem sikerült. A távoli verzió az utoljára ismert állapot.";
                }
                catch (TimeoutException) { error = "A GitHub ellenőrzése időtúllépéssel zárult. A távoli verzió az utoljára ismert állapot."; }
            }
            else error = "Nincs ellenőrizhető távoli követési beállítás.";
        }
        CommitInfo? remote = null;
        var ahead = 0;
        var behind = 0;
        if (upstream is not null)
        {
            var remoteResult = await Git("show", "-s", "--format=%H%n%s%n%cI", upstream);
            if (remoteResult.ExitCode == 0)
            {
                remote = ParseCommit(remoteResult.Output);
                var count = (await Git("rev-list", "--left-right", "--count", $"HEAD...{upstream}")).Output.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                if (count.Length == 2) { int.TryParse(count[0], out ahead); int.TryParse(count[1], out behind); }
            }
        }
        return new(string.IsNullOrEmpty(branch) ? "Detached HEAD" : branch, upstream, ParseCommit(head.Output), remote,
            !string.IsNullOrWhiteSpace(status), ahead, behind, lastVerified, error);
    }

    public static CommitInfo ParseCommit(string text)
    {
        var lines = text.Replace("\r", "").TrimEnd().Split('\n');
        if (lines.Length < 3 || lines[0].Length < 7) throw new InvalidOperationException("Hibás Git-verzióválasz.");
        return new(lines[0], lines[1], lines[2]);
    }
}
