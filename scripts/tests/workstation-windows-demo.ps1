[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$ProjectPath)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$installer = Join-Path $root 'scripts\install-workstation.ps1'
$ProjectPath = [IO.Path]::GetFullPath($ProjectPath)
if ($ProjectPath -eq $root -or !(Split-Path -Leaf $ProjectPath).StartsWith('HERMES Dev')) {
    throw 'Select a separate test directory whose name starts with HERMES Dev.'
}
$shortcut = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'HERMES Dev Rendszervezérlő.lnk'
$originalShortcut = if (Test-Path -LiteralPath $shortcut) { [IO.File]::ReadAllBytes($shortcut) } else { $null }

function Assert($Condition, $Message) { if (!$Condition) { throw $Message } }
function Install {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Demo -NoLaunch -ProjectPath $ProjectPath
    Assert ($LASTEXITCODE -eq 0) 'Windows demo installation failed.'
}
function Stamps {
    @('Backend', 'Frontend') | ForEach-Object {
        (Get-Content -LiteralPath (Join-Path $ProjectPath ".local\control-center\$_.json") -Raw | ConvertFrom-Json).ProcessId
    }
}

try {
    Install
    $settings = Get-Content -LiteralPath (Join-Path $ProjectPath '.local\control-center\settings.json') -Raw | ConvertFrom-Json
    $private = Join-Path $ProjectPath '.local\demo-data'
    $credentials = Get-Content -LiteralPath (Join-Path $private 'bejelentkezesek.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert ($credentials.users.Count -eq 10) 'Expected ten demo logins.'
    Assert ($credentials.url -eq "http://127.0.0.1:$($settings.FrontendPort)/") 'Saved frontend URL is incorrect.'
    Assert (Test-Path -LiteralPath (Join-Path $private 'BELEPESI_ADATOK.txt')) 'Missing readable login details.'
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
    Assert ($link.TargetPath.StartsWith($ProjectPath + '\', [StringComparison]::OrdinalIgnoreCase)) 'The desktop shortcut points elsewhere.'
    Assert ($link.Arguments -eq ('--root "{0}"' -f $ProjectPath)) 'Desktop shortcut arguments lost the project path.'
    $saved = (Get-FileHash -LiteralPath (Join-Path $private 'admin.json'), (Join-Path $private 'bejelentkezesek.json')).Hash -join ','
    $processIds = (Stamps) -join ','
    Install
    Assert (((Stamps) -join ',') -eq $processIds) 'The second run needlessly restarted existing services.'
    Assert (((Get-FileHash -LiteralPath (Join-Path $private 'admin.json'), (Join-Path $private 'bejelentkezesek.json')).Hash -join ',') -eq $saved) 'Test passwords changed on resume.'
    $version = Invoke-RestMethod "http://127.0.0.1:$($settings.BackendPort)/health/version"
    Assert ($version.environment -eq 'Development') 'API is not in Development mode.'
    & git -C $ProjectPath check-ignore .local/demo-data/admin.json .local/demo-data/bejelentkezesek.json .env
    Assert ($LASTEXITCODE -eq 0) 'Local secrets are not ignored by Git.'

    $guard = Join-Path $ProjectPath '.local\existing-project'
    $null = New-Item -ItemType Directory -Force -Path $guard
    $sentinel = Join-Path $guard '.env'
    [IO.File]::WriteAllText($sentinel, 'PRESERVE_EXISTING_PROJECT=true')
    $hash = (Get-FileHash -LiteralPath $sentinel).Hash
    $previousErrorAction = $ErrorActionPreference
    try {
        # Windows PowerShell turns redirected native stderr into ErrorRecords; this failure is expected.
        $ErrorActionPreference = 'Continue'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Demo -NoLaunch -ProjectPath $guard 2>&1 | Out-Host
        $guardExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorAction }
    Assert ($guardExitCode -ne 0) 'An existing, unmarked project was accepted.'
    Assert ((Get-FileHash -LiteralPath $sentinel).Hash -eq $hash) 'Existing project data changed.'
    Write-Host 'PASS: Windows install, desktop shortcut, health, demo permissions/logins/bookings, repeatability, and existing-data guard.'
} finally {
    # Only this test checkout's stamped processes and PostgreSQL cluster are stopped.
    $settingsPath = Join-Path $ProjectPath '.local\control-center\settings.json'
    if (Test-Path -LiteralPath $settingsPath) {
        $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        Assert ($settings.PostgresData -eq (Join-Path $ProjectPath '.local\workstation\postgres')) 'Unexpected database data path.'
        foreach ($kind in @('Frontend', 'Backend')) {
            $stampPath = Join-Path $ProjectPath ".local\control-center\$kind.json"
            if (!(Test-Path -LiteralPath $stampPath)) { continue }
            $stamp = Get-Content -LiteralPath $stampPath -Raw | ConvertFrom-Json
            $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$stamp.ProcessId)"
            if ($process -and $process.CommandLine.Contains($ProjectPath + '\') -and
                [Math]::Abs(($process.CreationDate.ToUniversalTime() - ([DateTimeOffset]::Parse($stamp.StartedAt)).UtcDateTime).TotalSeconds) -lt 2) {
                Stop-Process -Id $stamp.ProcessId -ErrorAction Stop
            }
        }
        & (Join-Path $settings.PostgresBin 'pg_ctl.exe') stop -D $settings.PostgresData -m fast -w -t 35
    }
    if (Test-Path -LiteralPath $shortcut) {
        $currentLink = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
        if ($currentLink.TargetPath.StartsWith($ProjectPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
            if ($originalShortcut) { [IO.File]::WriteAllBytes($shortcut, $originalShortcut) }
            else { Remove-Item -LiteralPath $shortcut }
        }
    }
}
