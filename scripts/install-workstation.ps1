[CmdletBinding()]
param(
    [string]$ProjectPath,
    [switch]$SkipShortcut,
    [switch]$Demo,
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$repository = 'https://github.com/NemodaMark/Hermes_flotter.git'
$toolsDirectory = Join-Path $env:LOCALAPPDATA 'HERMES\tools'

# Select and validate the destination before installing dependencies or changing a checkout.
$defaultFolder = if ($Demo) { 'HERMES-Dev' } else { 'HERMES' }
$pathSupplied = ![string]::IsNullOrWhiteSpace($ProjectPath)
while ($true) {
    if (!$ProjectPath) { $ProjectPath = Read-Host "Project directory (Enter for Documents\$defaultFolder)" }
    if ([string]::IsNullOrWhiteSpace($ProjectPath)) { $ProjectPath = Join-Path ([Environment]::GetFolderPath('MyDocuments')) $defaultFolder }
    $ProjectPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ProjectPath.Trim().Trim('"'))
    if (!$ProjectPath.Contains('%')) { break }
    $message = 'Vite cannot serve a project path containing %. Choose another directory.'
    if ($pathSupplied) { throw $message }
    Write-Warning $message
    $ProjectPath = ''
}
$demoMarker = Join-Path $ProjectPath '.local\workstation\dev-demo.json'
$demoInstallation = Join-Path $ProjectPath '.local\workstation\dev-installation.json'
if ($Demo -and (Test-Path -LiteralPath $ProjectPath) -and (Get-ChildItem -LiteralPath $ProjectPath -Force | Select-Object -First 1)) {
    if (!(Test-Path -LiteralPath $demoMarker)) { throw 'For demo installation select a NEW, empty directory. Existing projects and databases are preserved.' }
    $marker = Get-Content -LiteralPath $demoMarker -Raw | ConvertFrom-Json
    if ($marker.schema -ne 1 -or $marker.projectPath -ne $ProjectPath) { throw 'The demo marker belongs to a different installation.' }
}
# A completed provision can be resumed without rebuilding assemblies that its services are using.
if ($Demo -and (Test-Path -LiteralPath $demoInstallation)) {
    & (Join-Path $ProjectPath 'scripts\initialize-demo-workstation.ps1') -ProjectPath $ProjectPath -NoLaunch:$NoLaunch -SkipShortcut:$SkipShortcut
    return
}

function Invoke-Checked($Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE)." }
}

function Find-Application($Name) {
    (Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
}

function Install-WingetPackage($Id) {
    $winget = Find-Application 'winget.exe'
    if (!$winget) { throw 'Install or update App Installer from the Microsoft Store to make winget available.' }
    Invoke-Checked $winget @('install', '--id', $Id, '--exact', '--source', 'winget',
        '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity')
    $env:PATH += ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') +
        ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Find-Dotnet10 {
    $candidates = @((Find-Application 'dotnet.exe'), "$env:ProgramFiles\dotnet\dotnet.exe",
        "$env:USERPROFILE\.codex\tools\hermes\dotnet\dotnet.exe")
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate) -and ((& $candidate --list-sdks) -match '^10\.')) {
            return $candidate
        }
    }
}

function Get-Archive($Url, $Destination, $ExpectedHash, [string[]]$Entries = @()) {
    $resolvedTools = (Resolve-Path -LiteralPath $toolsDirectory).ProviderPath
    $prefix = $resolvedTools + [IO.Path]::DirectorySeparatorChar
    $Destination = [IO.Path]::GetFullPath($Destination)
    if (!$Destination.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'The package destination is outside the HERMES tools directory.' }
    $zip = Join-Path $resolvedTools (([guid]::NewGuid()).ToString() + '.zip')
    $extractPath = "$zip.extract"
    try {
        $curl = Find-Application 'curl.exe'
        Invoke-Checked $curl @('--fail', '--silent', '--show-error', '--location', '--retry', '2', '--output', $zip, $Url)
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $ExpectedHash) { throw "SHA-256 mismatch for $Url" }
        $null = New-Item -ItemType Directory -Path $extractPath
        $tar = Find-Application 'tar.exe'
        Invoke-Checked $tar (@('-xf', $zip, '-C', $extractPath) + $Entries)
        $resolved = (Resolve-Path -LiteralPath $extractPath).ProviderPath
        if (!$resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected temporary package directory.' }
        [IO.Directory]::Move($resolved, $Destination)
    } finally {
        if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip }
        if (Test-Path -LiteralPath $extractPath) {
            $resolved = (Resolve-Path -LiteralPath $extractPath).ProviderPath
            if ($resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $resolved -Recurse -Force
            }
        }
    }
}

function Test-NodeVersion($Executable) {
    if (!$Executable -or !(Test-Path -LiteralPath $Executable)) { return $false }
    $version = & $Executable --version
    return $version -match '^v(22\.(2[0-9]|[3-9][0-9]|[0-9]{3,})\.|2[4-9]\.|[3-9][0-9]\.|[0-9]{3,}\.)'
}

if ($env:OS -ne 'Windows_NT' -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'This installer supports Windows x64.'
}
$git = Find-Application 'git.exe'
if (!$git) {
    Install-WingetPackage 'Git.Git'
    $git = Find-Application 'git.exe'
}
$dotnet = Find-Dotnet10
if (!$dotnet) {
    Install-WingetPackage 'Microsoft.DotNet.SDK.10'
    $dotnet = Find-Dotnet10
}
if (!$git -or !$dotnet) { throw 'Git or the .NET 10 SDK could not be located after installation.' }

$null = New-Item -ItemType Directory -Force -Path $toolsDirectory
$node = Find-Application 'node.exe'
if (!(Test-NodeVersion $node) -or !(Test-Path -LiteralPath (Join-Path (Split-Path -Parent $node) 'npm.cmd'))) {
    $dist = 'https://nodejs.org/dist/latest-v22.x'
    $checksums = Invoke-RestMethod "$dist/SHASUMS256.txt"
    $entry = [regex]::Match([string]$checksums, '(?m)^([a-f0-9]{64})[ \t]+(node-v22\.\d+\.\d+-win-x64)\.zip\r?$')
    if (!$entry.Success) { throw 'The official Node.js checksum list does not contain the Windows x64 archive.' }
    $name = $entry.Groups[2].Value
    $nodeHome = Join-Path $toolsDirectory $name
    $node = Join-Path $nodeHome "$name\node.exe"
    if (!(Test-Path -LiteralPath $node)) { Get-Archive "$dist/$name.zip" $nodeHome $entry.Groups[1].Value }
    if (!(Test-NodeVersion $node)) { throw 'The installed Node.js version is incompatible.' }
}
$npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'

$pgHome = Join-Path $toolsDirectory 'postgresql-18.7'
$postgres = Join-Path $pgHome 'pgsql\bin'
if (!(Test-Path -LiteralPath (Join-Path $postgres 'pg_ctl.exe'))) {
    if (!(Test-Path -LiteralPath "$env:SystemRoot\System32\vcruntime140.dll")) {
        Install-WingetPackage 'Microsoft.VCRedist.2015+.x64'
    }
    $pgArchive = 'https://get.enterprisedb.com/postgresql/postgresql-18.7-1-windows-x64-binaries.zip'
    Get-Archive $pgArchive $pgHome 'EAD0BBC27FB678FA24DCF86B738981323042ABD073C744103BF7F3AED23F9A33' @(
        'pgsql/bin', 'pgsql/lib', 'pgsql/share', 'pgsql/server_license.txt', 'pgsql/commandlinetools_3rd_party_licenses.txt')
}
$env:PATH = "$(Split-Path -Parent $dotnet);$(Split-Path -Parent $node);$env:PATH"
$env:DOTNET_ROOT = Split-Path -Parent $dotnet

if (Test-Path -LiteralPath (Join-Path $ProjectPath '.git')) {
    $origin = Invoke-Checked $git @('-C', $ProjectPath, 'config', '--get', 'remote.origin.url')
    if ($origin -notin @($repository, ($repository -replace '\.git$', ''), 'git@github.com:NemodaMark/Hermes_flotter.git',
        'ssh://git@github.com/NemodaMark/Hermes_flotter.git')) { throw 'The selected checkout has a different origin.' }
    $branch = Invoke-Checked $git @('-C', $ProjectPath, 'branch', '--show-current')
    $changes = Invoke-Checked $git @('-C', $ProjectPath, 'status', '--porcelain')
    if ($branch -cne 'main' -or $changes) { throw 'Select a clean HERMES main checkout or a new directory.' }
    Invoke-Checked $git @('-C', $ProjectPath, 'pull', '--ff-only', 'origin', 'main')
} else {
    Invoke-Checked $git @('clone', '--branch', 'main', '--', $repository, $ProjectPath)
}
if ($Demo -and !(Test-Path -LiteralPath $demoMarker)) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $demoMarker)
    @{ schema = 1; projectPath = $ProjectPath; createdAt = [DateTimeOffset]::UtcNow.ToString('O') } |
        ConvertTo-Json | Set-Content -LiteralPath $demoMarker -Encoding UTF8
}

Push-Location -LiteralPath $ProjectPath
try {
    Invoke-Checked $dotnet @('build', 'backend/src/Hermes.Api/Hermes.Api.csproj', '-c', 'Debug', '--nologo')
    Invoke-Checked $npm @('--prefix', 'frontend', 'ci')
    $launcher = Join-Path $ProjectPath '.local\workstation\launcher'
    $firstSetup = !(Test-Path -LiteralPath (Join-Path $ProjectPath '.env'))
    Invoke-Checked $dotnet @('publish', 'desktop/src/Hermes.Workstation/Hermes.Workstation.csproj', '-c', 'Release', '-o', $launcher, '--nologo')
    $cli = Join-Path $launcher 'Hermes.Workstation.dll'
    Invoke-Checked $dotnet @($cli, 'prepare', $ProjectPath, $postgres, $dotnet, $node, $git)
    $shortcutArguments = @{ NoLaunch = $true; CreateShortcut = !$SkipShortcut; PassThru = $true }
    if ($Demo) { $shortcutArguments.ShortcutName = 'HERMES Dev Rendszervezérlő' }
    $controlCenter = & (Join-Path $ProjectPath 'scripts\start-control-center.ps1') @shortcutArguments

    if ($Demo) {
        @{ controlCenterExecutable = $controlCenter.ExecutablePath; shortcutPath = $controlCenter.ShortcutPath } |
            ConvertTo-Json | Set-Content -LiteralPath $demoInstallation -Encoding UTF8
        & (Join-Path $ProjectPath 'scripts\initialize-demo-workstation.ps1') -ProjectPath $ProjectPath -NoLaunch:$NoLaunch -SkipShortcut:$SkipShortcut
    } elseif (!$SkipShortcut) {
        if ($firstSetup) {
            $username = Read-Host 'First system administrator username (Enter to skip)'
            if ($username) {
                $email = Read-Host 'Email'
                Invoke-Checked $dotnet @($cli, 'admin', $ProjectPath, $username, $email)
            }
        }
        Write-Host 'Open HERMES Rendszervezerlo from the Desktop and start the services.'
    }
    Write-Host "Installed at $ProjectPath"
} finally {
    Pop-Location
}
