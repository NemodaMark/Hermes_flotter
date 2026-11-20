[CmdletBinding()]
param([string]$OutputPath)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (!$OutputPath) { $OutputPath = Join-Path $root '.local\installers\HERMES-Windows-Dev.zip' }
$OutputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath)
Compress-Archive -LiteralPath @(
    (Join-Path $PSScriptRoot 'install-dev-windows.cmd'),
    (Join-Path $PSScriptRoot 'install-workstation.ps1'),
    (Join-Path $root 'docs\WINDOWS_DEV_TELEPITES.md')
) -DestinationPath $OutputPath -Force
$hash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$OutputPath.sha256", "$hash  $([IO.Path]::GetFileName($OutputPath))`n")
Get-Item -LiteralPath $OutputPath, "$OutputPath.sha256"
