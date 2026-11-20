param(
    [switch]$CreateShortcut,
    [switch]$NoLaunch,
    [switch]$PassThru,
    [ValidatePattern('^[^\\/:*?"<>|]+$')]
    [string]$ShortcutName = 'HERMES Rendszervezérlő'
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
& $dotnetPath publish (Join-Path $projectRoot 'desktop\src\Hermes.ControlCenter\Hermes.ControlCenter.csproj') -c Release -r win-x64 --self-contained true -o $outputPath --nologo | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'A vezérlő fordítása nem sikerült.' }
$executablePath = Join-Path $outputPath 'Hermes.ControlCenter.exe'
if ($CreateShortcut) {
    . (Join-Path $PSScriptRoot 'control-center-shortcut.ps1')
    $shortcutPath = New-HermesDesktopShortcut -ProjectRoot $projectRoot -ExecutablePath $executablePath -Name $ShortcutName
    Write-Host "Parancsikon: $shortcutPath"
}
Write-Host "Vezérlő: $executablePath"
if (-not $NoLaunch) { Start-Process -FilePath $executablePath -ArgumentList "--root `"$projectRoot`"" -WorkingDirectory $projectRoot }
if ($PassThru) { [pscustomobject]@{ ExecutablePath = $executablePath; ShortcutPath = $shortcutPath } }
