param(
    [switch]$Migrate,
    [string]$BootstrapSystemAdminUserId,
    [int]$DatabasePort = 0
)

$ErrorActionPreference = 'Stop'
if ($Migrate -and $BootstrapSystemAdminUserId) { throw 'A migrációt és az első rendszerszintű jog kiosztását külön paranccsal futtasd.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Először másold a .env.example fájlt .env néven a projekt gyökerébe.' }
$settings = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^\s*([A-Z_]+)=(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
}
foreach ($required in @('POSTGRES_APP_PASSWORD', 'POSTGRES_MIGRATOR_PASSWORD')) {
    if ([string]::IsNullOrWhiteSpace($settings[$required])) { throw "Hiányzó beállítás: $required" }
}

$dotnetCommand = Get-Command dotnet -ErrorAction SilentlyContinue
$dotnetPath = if ($dotnetCommand) { $dotnetCommand.Source } else { $null }
$sdkList = if ($dotnetPath) { & $dotnetPath --list-sdks } else { @() }
if (-not ($sdkList -match '^10\.')) {
    $localSdk = Join-Path $env:USERPROFILE '.codex\tools\hermes\dotnet\dotnet.exe'
    if (-not (Test-Path -LiteralPath $localSdk)) { throw 'Telepíts .NET 10 SDK-t a backend futtatásához.' }
    $dotnetPath = $localSdk
    $env:DOTNET_ROOT = Split-Path -Parent $localSdk
    $env:PATH = "$env:DOTNET_ROOT;$env:PATH"
}

if ($DatabasePort -eq 0) { $DatabasePort = if ($settings['POSTGRES_PORT']) { [int]$settings['POSTGRES_PORT'] } else { 5432 } }
if ($DatabasePort -lt 1 -or $DatabasePort -gt 65535) { throw 'Érvénytelen adatbázis-port.' }
function Get-ConnectionString([string]$Username, [string]$Password) {
    $connection = [System.Data.Common.DbConnectionStringBuilder]::new()
    $connection['Host'] = '127.0.0.1'
    $connection['Port'] = "$DatabasePort"
    $connection['Database'] = 'hermes'
    $connection['Username'] = $Username
    $connection['Password'] = $Password
    return $connection.ConnectionString
}
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ASPNETCORE_URLS = 'http://127.0.0.1:5080'
$env:ConnectionStrings__Database = Get-ConnectionString 'hermes_app' $settings['POSTGRES_APP_PASSWORD']
if ($Migrate -or $BootstrapSystemAdminUserId) { $env:ConnectionStrings__Migrations = Get-ConnectionString 'hermes_migrator' $settings['POSTGRES_MIGRATOR_PASSWORD'] }

Push-Location (Join-Path $projectRoot 'backend\src\Hermes.Api')
try {
    $arguments = @('run', '--no-launch-profile')
    if ($BootstrapSystemAdminUserId) { $arguments += @('--configuration', 'Release') }
    if ($Migrate) { $arguments += @('--', '--migrate') }
    elseif ($BootstrapSystemAdminUserId) { $arguments += @('--', '--bootstrap-system-admin', $BootstrapSystemAdminUserId) }
    & $dotnetPath @arguments
    if ($LASTEXITCODE -ne 0) { throw 'A backend parancs hibával fejeződött be.' }
} finally { Pop-Location }
