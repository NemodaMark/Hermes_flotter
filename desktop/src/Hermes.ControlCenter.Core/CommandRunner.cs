using System.Diagnostics;

namespace Hermes.ControlCenter.Core;

public sealed record Command(string FileName, IReadOnlyList<string> Arguments, string WorkingDirectory,
    IReadOnlyDictionary<string, string>? Environment = null, bool CaptureOutput = true);
public sealed record CommandResult(int ExitCode, string Output, string Error);

public interface ICommandRunner
{
    Task<CommandResult> RunAsync(Command command, TimeSpan timeout, CancellationToken cancellationToken = default);
}

public sealed class CommandRunner : ICommandRunner
{
    public static ProcessStartInfo StartInfo(Command command)
    {
        var info = new ProcessStartInfo(command.FileName)
        {
            WorkingDirectory = command.WorkingDirectory, UseShellExecute = false,
            CreateNoWindow = true, RedirectStandardOutput = command.CaptureOutput, RedirectStandardError = command.CaptureOutput,
            StandardOutputEncoding = command.CaptureOutput ? new System.Text.UTF8Encoding(false) : null,
            StandardErrorEncoding = command.CaptureOutput ? new System.Text.UTF8Encoding(false) : null
        };
        foreach (var argument in command.Arguments) info.ArgumentList.Add(argument);
        if (command.Environment is not null)
            foreach (var (key, value) in command.Environment) info.Environment[key] = value;
        return info;
    }

    public async Task<CommandResult> RunAsync(Command command, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        using var process = new Process { StartInfo = StartInfo(command) };
        process.Start();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        var output = command.CaptureOutput ? process.StandardOutput.ReadToEndAsync(deadline.Token) : Task.FromResult("");
        var error = command.CaptureOutput ? process.StandardError.ReadToEndAsync(deadline.Token) : Task.FromResult("");
        try
        {
            await process.WaitForExitAsync(deadline.Token);
            await Task.WhenAll(output, error).WaitAsync(deadline.Token);
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None);
            if (cancellationToken.IsCancellationRequested) throw;
            throw new TimeoutException($"A(z) {Path.GetFileName(command.FileName)} művelet túllépte az időkorlátot.");
        }
        return new(process.ExitCode, await output, await error);
    }
}
