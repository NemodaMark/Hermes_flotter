function New-HermesDesktopShortcut {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [ValidatePattern('^[^\\/:*?"<>|]+$')][string]$Name = 'HERMES Rendszervezérlő'
    )
    $desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory, [Environment+SpecialFolderOption]::Create)
    $path = Join-Path $desktop "$Name.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $ExecutablePath
    $shortcut.Arguments = '--root "{0}"' -f $ProjectRoot
    $shortcut.WorkingDirectory = $ProjectRoot
    $shortcut.Description = 'HERMES folyamatok, health, Git-verziók és újraindítás'
    $shortcut.Save()
    return $path
}
