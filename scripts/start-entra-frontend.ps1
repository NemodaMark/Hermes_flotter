param([switch]$TrustCertificate, [ValidateRange(1, 65535)][int]$Port = 5174)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$command = Get-Command dotnet -ErrorAction SilentlyContinue
$dotnet = if ($command) { $command.Source } else { $null }
if (!$dotnet -or -not (& $dotnet --list-sdks | Select-String '^10\.')) {
    $dotnet = Join-Path $env:USERPROFILE '.codex/tools/hermes/dotnet/dotnet.exe'
    if (!(Test-Path -LiteralPath $dotnet)) { throw 'A helyi HTTPS-hez .NET 10 SDK szükséges.' }
}

$directory = Join-Path $root '.local/entra-https'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$cert = Join-Path $directory 'localhost.pem'
$key = Join-Path $directory 'localhost.key'
$arguments = @('dev-certs', 'https', '--export-path', $cert, '--format', 'PEM', '--no-password')
if ($TrustCertificate) { $arguments += '--trust' }
& $dotnet @arguments
if ($LASTEXITCODE -ne 0) { throw 'A localhost HTTPS-tanúsítvány exportálása nem sikerült.' }

$env:HERMES_DEV_TLS_CERT = $cert
$env:HERMES_DEV_TLS_KEY = $key
Write-Host "Microsoft Entra Web redirect URI: https://localhost:${Port}/api/v1/auth/entra/callback"
npm --prefix (Join-Path $root 'frontend') run dev -- --port $Port
