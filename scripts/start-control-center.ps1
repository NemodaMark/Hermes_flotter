param(
    [switch]$CreateShortcut,
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dotnetCommand = Get-Command dotnet -ErrorAction SilentlyContinue
$dotnetPath = if ($dotnetCommand) { $dotnetCommand.Source } else { $null }
$sdks = if ($dotnetPath) { & $dotnetPath --list-sdks } else { @() }
if (-not ($sdks -match '^10\.')) {
    $dotnetPath = Join-Path $env:USERPROFILE '.codex\tools\hermes\dotnet\dotnet.exe'
    if (-not (Test-Path -LiteralPath $dotnetPath)) { throw 'A fordításhoz .NET 10 SDK szükséges.' }
    $env:DOTNET_ROOT = Split-Path -Parent $dotnetPath
    $env:PATH = "$env:DOTNET_ROOT;$env:PATH"
}

# A separate release directory lets existing service hosts keep running during a new desktop build.
$releaseId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$outputPath = Join-Path $projectRoot ".local\control-center\releases\$releaseId"
& $dotnetPath publish (Join-Path $projectRoot 'desktop\src\Hermes.ControlCenter\Hermes.ControlCenter.csproj') -c Release -r win-x64 --self-contained true -o $outputPath --nologo
if ($LASTEXITCODE -ne 0) { throw 'A vezérlő fordítása nem sikerült.' }
$executablePath = Join-Path $outputPath 'Hermes.ControlCenter.exe'
if ($CreateShortcut) {
    $desktopPath = [Environment]::GetFolderPath('DesktopDirectory')
    $shortcutPath = Join-Path $desktopPath 'HERMES Rendszervezérlő.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $executablePath
    $shortcut.Arguments = "--root `"$projectRoot`""
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = 'HERMES folyamatok, health, Git-verziók és újraindítás'
    $shortcut.Save()
    Write-Output "Parancsikon: $shortcutPath"
}
Write-Output "Vezérlő: $executablePath"
if (-not $NoLaunch) { Start-Process -FilePath $executablePath -ArgumentList "--root `"$projectRoot`"" -WorkingDirectory $projectRoot }
