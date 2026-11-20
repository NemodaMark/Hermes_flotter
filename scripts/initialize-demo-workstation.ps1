[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$ProjectPath, [switch]$NoLaunch, [switch]$SkipShortcut)

$ErrorActionPreference = 'Stop'
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).ProviderPath
$work = Join-Path $ProjectPath '.local\workstation'
$marker = Get-Content -LiteralPath (Join-Path $work 'dev-demo.json') -Raw | ConvertFrom-Json
if ($env:OS -ne 'Windows_NT' -or $marker.schema -ne 1 -or $marker.projectPath -ne $ProjectPath) {
    throw 'This command requires a Windows development demo installation.'
}
$installation = Get-Content -LiteralPath (Join-Path $work 'dev-installation.json') -Raw | ConvertFrom-Json
$settings = Get-Content -LiteralPath (Join-Path $ProjectPath '.local\control-center\settings.json') -Raw | ConvertFrom-Json
if ($settings.PostgresData -ne (Join-Path $work 'postgres') -or
    !$installation.controlCenterExecutable.StartsWith($ProjectPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The database or desktop launcher belongs to another installation.'
}
$cli = Join-Path $work 'launcher\Hermes.Workstation.dll'
$logDirectory = Join-Path $ProjectPath '.local\control-center\logs'
$baseUrl = "http://127.0.0.1:$($settings.BackendPort)"
$frontendUrl = "http://127.0.0.1:$($settings.FrontendPort)/"
$demoDirectory = Join-Path $ProjectPath '.local\demo-data'
$adminPath = Join-Path $demoDirectory 'admin.json'
$credentialsPath = Join-Path $demoDirectory 'BELEPESI_ADATOK.txt'
$lock = [IO.File]::Open((Join-Path $work 'demo.lock'), 'OpenOrCreate', 'Write', 'None')

function Invoke-Checked($Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). Logs: $logDirectory" }
}

function Save-Json($Path, $Value) {
    [IO.File]::WriteAllText("$Path.new", ($Value | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace("$Path.new", $Path, [NullString]::Value) }
    else { [IO.File]::Move("$Path.new", $Path) }
}

function Test-OwnedWebService($Kind) {
    $stampPath = Join-Path $ProjectPath ".local\control-center\$Kind.json"
    if (!(Test-Path -LiteralPath $stampPath)) { return $false }
    $stamp = Get-Content -LiteralPath $stampPath -Raw | ConvertFrom-Json
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$stamp.ProcessId)"
    if (!$process) { return $false }
    $entryPoint = if ($Kind -eq 'Backend') { Join-Path $ProjectPath 'backend\src\Hermes.Api\bin\Debug\net10.0\Hermes.Api.dll' }
        else { Join-Path $ProjectPath 'frontend\node_modules\vite\bin\vite.js' }
    $executable = if ($Kind -eq 'Backend') { $settings.DotnetPath } else { $settings.NodePath }
    $tokens = [regex]::Matches($process.CommandLine, '"([^"]*)"|([^\s"]+)') | ForEach-Object {
        if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value }
    }
    return $process.ExecutablePath -eq $executable -and $tokens -contains $entryPoint -and
        [Math]::Abs(($process.CreationDate.ToUniversalTime() - ([DateTimeOffset]::Parse($stamp.StartedAt)).UtcDateTime).TotalSeconds) -lt 2
}

function Assert-FreePort([int]$Port) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() }
    catch { throw "Port $Port is occupied by another process. It has not been stopped." }
    finally { $listener.Stop() }
}

function Start-DemoServices {
    $pg = Join-Path $settings.PostgresBin 'pg_ctl.exe'
    & $pg status -D $settings.PostgresData | Out-Host
    if ($LASTEXITCODE -eq 3) {
        Assert-FreePort $settings.DatabasePort
        # No redirected pipes: pg_ctl starts a detached server, with output written to -l.
        $arguments = @('start', '-D', ('"{0}"' -f $settings.PostgresData), '-l', ('"{0}"' -f (Join-Path $logDirectory 'Database.log')),
            '-w', '-t', '35', '-o', ('"-p {0} -h 127.0.0.1"' -f $settings.DatabasePort))
        $started = Start-Process -FilePath $pg -ArgumentList $arguments -WorkingDirectory $ProjectPath -WindowStyle Hidden -PassThru
        # Start-Process -Wait waits for the entire process tree, including the persistent PostgreSQL child.
        if (!$started.WaitForExit(45000)) { throw "PostgreSQL startup timed out. Logs: $logDirectory" }
        if ($started.ExitCode -ne 0) { throw "PostgreSQL failed to start. Logs: $logDirectory" }
    } elseif ($LASTEXITCODE -ne 0) { throw 'The development database status could not be read.' }
    foreach ($kind in @('Backend', 'Frontend')) {
        if (Test-OwnedWebService $kind) { continue }
        $port = if ($kind -eq 'Backend') { $settings.BackendPort } else { $settings.FrontendPort }
        Assert-FreePort $port
        Start-Process -FilePath $installation.controlCenterExecutable -ArgumentList @('--service-host', $kind, '--root', ('"{0}"' -f $ProjectPath)) `
            -WorkingDirectory $ProjectPath -WindowStyle Hidden
    }
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(90)
    do {
        try {
            $null = Invoke-WebRequest "$baseUrl/health/ready" -UseBasicParsing -TimeoutSec 3
            $null = Invoke-WebRequest $frontendUrl -UseBasicParsing -TimeoutSec 3
            if ((Test-OwnedWebService 'Backend') -and (Test-OwnedWebService 'Frontend')) { return }
        } catch { }
        Start-Sleep -Seconds 1
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "The development services did not become ready. Logs: $logDirectory"
}

function Test-InitializedAdmin($Admin) {
    # Recover the checkpoint if setup was interrupted just after the database committed the first admin.
    $csrf = Invoke-RestMethod "$baseUrl/api/v1/auth/csrf" -SessionVariable loginSession -TimeoutSec 5
    try {
        $result = Invoke-RestMethod "$baseUrl/api/v1/auth/login" -Method Post -WebSession $loginSession -TimeoutSec 10 `
            -ContentType 'application/json' -Headers @{ 'X-CSRF-TOKEN' = $csrf.requestToken } `
            -Body (@{ userName = $Admin.userName; password = $Admin.password } | ConvertTo-Json)
    } catch {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -in @(400, 401)) { return $false }
        throw
    }
    if ($result.id -ne $Admin.userName -or $result.systemPermissions -notcontains 'system.manage') {
        throw 'The saved demo login does not identify the expected system administrator.'
    }
    $csrf = Invoke-RestMethod "$baseUrl/api/v1/auth/csrf" -WebSession $loginSession -TimeoutSec 5
    $null = Invoke-RestMethod "$baseUrl/api/v1/auth/logout" -Method Post -WebSession $loginSession -TimeoutSec 5 `
        -Headers @{ 'X-CSRF-TOKEN' = $csrf.requestToken }
    return $true
}

try {
    $null = New-Item -ItemType Directory -Force -Path $demoDirectory
    # Generated test passwords inherit access for the current Windows user and SYSTEM only.
    $directory = New-Object IO.DirectoryInfo($demoDirectory)
    $accessOnly = [Security.AccessControl.AccessControlSections]::Access
    $acl = if ($PSVersionTable.PSEdition -eq 'Desktop') { $directory.GetAccessControl($accessOnly) }
        else { [IO.FileSystemAclExtensions]::GetAccessControl($directory, $accessOnly) }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existingRule in @($acl.Access)) { $null = $acl.RemoveAccessRuleSpecific($existingRule) }
    foreach ($identity in @([Security.Principal.WindowsIdentity]::GetCurrent().User, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    # Set-Acl also attempts to write the SACL under Windows PowerShell; updating only the DACL needs no admin privilege.
    if ($PSVersionTable.PSEdition -eq 'Desktop') { $directory.SetAccessControl($acl) }
    else { [IO.FileSystemAclExtensions]::SetAccessControl($directory, $acl) }
    if (!(Test-Path -LiteralPath $adminPath)) {
        $bytes = New-Object byte[] 24
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($bytes) } finally { $random.Dispose() }
        Save-Json $adminPath @{ userName = 'admin'; email = 'admin@hermes-dev.example.test'; password = [Convert]::ToBase64String($bytes); initialized = $false }
    }
    $admin = Get-Content -LiteralPath $adminPath -Raw | ConvertFrom-Json
    Start-DemoServices
    if (!$admin.initialized) {
        $previousPassword = $env:HERMES_INITIAL_ADMIN_PASSWORD
        try {
            $env:HERMES_INITIAL_ADMIN_PASSWORD = $admin.password
            if (!(Test-InitializedAdmin $admin)) {
                Invoke-Checked $settings.DotnetPath @($cli, 'admin', $ProjectPath, $admin.userName, $admin.email)
            }
        } finally { $env:HERMES_INITIAL_ADMIN_PASSWORD = $previousPassword }
        $admin.initialized = $true
        Save-Json $adminPath $admin
    }
    $seed = Join-Path $ProjectPath 'scripts\seed-demo-data.mjs'
    $variables = @('HERMES_SEED_ADMIN_PASSWORD', 'HERMES_SEED_ADMIN_USER', 'HERMES_BASE_URL', 'HERMES_FRONTEND_URL')
    $previous = @{}
    foreach ($name in $variables) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    try {
        $env:HERMES_SEED_ADMIN_PASSWORD = $admin.password
        $env:HERMES_SEED_ADMIN_USER = $admin.userName
        $env:HERMES_BASE_URL = $baseUrl
        $env:HERMES_FRONTEND_URL = $frontendUrl
        Invoke-Checked $settings.NodePath @($seed, '--with-bookings')
    } finally {
        foreach ($name in $variables) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    }
    $accounts = Get-Content -LiteralPath (Join-Path $demoDirectory 'bejelentkezesek.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $lines = @('HERMES - helyi fejlesztői tesztkörnyezet', "Cím: $frontendUrl", "Projekt: $ProjectPath", '',
        "Rendszergazda: $($admin.userName)", "Jelszó: $($admin.password)", '', 'Demo Flotta - beléphető tesztfiókok:')
    foreach ($account in $accounts.users) {
        $status = if ($account.suspended) { 'FELFÜGGESZTETT cégtagság' } else { 'aktív' }
        $lines += "`r`n$($account.displayName) - $($account.group) ($status)`r`nFelhasználó: $($account.userName)`r`nJelszó: $($account.password)"
    }
    $lines += @('', 'A 4 foglalható autó: DEMO-002, DEMO-003, DEMO-004, DEMO-006 (8 mintafoglalás).',
        'Egy foglalás legfeljebb 7 nap. Egy tesztfiók cégtagsága szándékosan fel van függesztve.',
        'Ezek helyi tesztjelszavak. A fájlt és a .local könyvtárat ne küldd tovább és ne commitold.')
    [IO.File]::WriteAllLines($credentialsPath, $lines, (New-Object Text.UTF8Encoding($true)))
    if (!$SkipShortcut) {
        . (Join-Path $PSScriptRoot 'control-center-shortcut.ps1')
        $installation.shortcutPath = New-HermesDesktopShortcut -ProjectRoot $ProjectPath -ExecutablePath $installation.controlCenterExecutable -Name 'HERMES Dev Rendszervezérlő'
        Save-Json (Join-Path $work 'dev-installation.json') $installation
    }
    Invoke-Checked $settings.DotnetPath @($cli, 'status', $ProjectPath)
    Write-Host "`nDevelopment demo ready: $frontendUrl"
    Write-Host "Login details: $credentialsPath"
    if (!$NoLaunch) {
        Start-Process $frontendUrl
        Start-Process notepad.exe -ArgumentList ('"{0}"' -f $credentialsPath)
        Start-Process -FilePath $installation.controlCenterExecutable -ArgumentList @('--root', ('"{0}"' -f $ProjectPath)) -WorkingDirectory $ProjectPath
    }
} finally { $lock.Dispose() }
