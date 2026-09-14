<#
.SYNOPSIS
    Builds the JobTrack Windows installer locally: the Node payload, the .NET tray host, and the
    Inno Setup installer, in that order.

.DESCRIPTION
    The same three steps .github/workflows/windows-release.yml runs, minus signing and the release.

    The payload comes from one of two places, picked with -Source or from a menu when it is left out:

      Registry  The pinned node.exe plus a published jobtrack release and @jobtrack/mcp@latest from
                npm. What a release ships. -Version picks the jobtrack version; the default is the
                latest one on the registry.
      Local     This checkout, packed with npm pack (build-payload.mjs --local --with-mcp). For
                trying a change before it is published. The version is apps/tray/package.json's.

    The host is always built from this checkout, as in CI.

    ISCC.exe is looked for in the ISCC environment variable, then in Inno Setup's own uninstall
    registration, then in the per-user and machine-wide install folders, then on PATH.

.PARAMETER Source
    Registry or Local. Asked for when omitted.

.PARAMETER Version
    The jobtrack version to package with -Source Registry. Defaults to the latest published.

.PARAMETER SkipSmoke
    Skips the payload's launch test. Its first run downloads the embedding model.

.PARAMETER NodeExe
    Reuses an existing node.exe instead of downloading the pinned runtime.

.PARAMETER KeepDml
    Keeps the DirectML execution provider in the payload.

.EXAMPLE
    ./windows/build.ps1

.EXAMPLE
    ./windows/build.ps1 -Source Local -SkipSmoke

.EXAMPLE
    ./windows/build.ps1 -Source Registry -Version 1.5.0
#>
[CmdletBinding()]
param(
    [ValidateSet('Registry', 'Local')]
    [string]$Source,
    [string]$Version,
    [switch]$SkipSmoke,
    [string]$NodeExe,
    [switch]$KeepDml
)

$ErrorActionPreference = 'Stop'

$windowsDir = $PSScriptRoot
$repoRoot = Split-Path $windowsDir -Parent
$installerDir = Join-Path $windowsDir 'installer'
$payloadDir = Join-Path $installerDir 'payload'

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

# Native commands do not throw on failure, even with $ErrorActionPreference = 'Stop'.
function Invoke-Native([string]$What, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

function Find-Iscc {
    if ($env:ISCC -and (Test-Path $env:ISCC)) { return $env:ISCC }

    # Inno Setup registers its install folder like any other program, per-user or machine-wide.
    $uninstallKeys = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup*'
    )
    foreach ($key in $uninstallKeys) {
        $entries = Get-ItemProperty $key -ErrorAction SilentlyContinue | Sort-Object DisplayVersion -Descending
        foreach ($entry in $entries) {
            if ($entry.InstallLocation) {
                $candidate = Join-Path $entry.InstallLocation 'ISCC.exe'
                if (Test-Path $candidate) { return $candidate }
            }
        }
    }

    # The folder name carries the major version, so match "Inno Setup *" rather than pinning 6.
    $roots = @("$env:LOCALAPPDATA\Programs", ${env:ProgramFiles(x86)}, $env:ProgramFiles) |
        Where-Object { $_ -and (Test-Path $_) }
    foreach ($root in $roots) {
        $found = Get-ChildItem $root -Directory -Filter 'Inno Setup*' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'ISCC.exe' } |
            Where-Object { Test-Path $_ } |
            Select-Object -First 1
        if ($found) { return $found }
    }

    $onPath = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    throw 'ISCC.exe not found. Install Inno Setup 6 (winget install JRSoftware.InnoSetup), or set $env:ISCC to its full path.'
}

# ---------------------------------------------------------------------------------- prerequisites

foreach ($tool in 'node', 'npm', 'dotnet') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH." }
}
$iscc = Find-Iscc

if (-not $Source) {
    $choices = [System.Management.Automation.Host.ChoiceDescription[]]@(
        (New-Object System.Management.Automation.Host.ChoiceDescription '&Registry', 'Pinned node.exe plus the latest jobtrack and @jobtrack/mcp published on npm'),
        (New-Object System.Management.Automation.Host.ChoiceDescription '&Local', 'This checkout, packed with npm pack (--local --with-mcp)')
    )
    $picked = $Host.UI.PromptForChoice('JobTrack Windows build', 'Where should the payload come from?', $choices, 0)
    $Source = @('Registry', 'Local')[$picked]
}

if ($Source -eq 'Local' -and $Version) {
    throw '-Version only applies to -Source Registry. A local build uses the version in apps/tray/package.json.'
}

if ($Source -eq 'Registry' -and -not $Version) {
    $Version = (Invoke-RestMethod 'https://registry.npmjs.org/jobtrack/latest' -Headers @{ 'Cache-Control' = 'no-cache' }).version
}
if ($Source -eq 'Local') {
    $Version = (Get-Content (Join-Path $repoRoot 'apps/tray/package.json') -Raw | ConvertFrom-Json).version
}

Write-Host ''
Write-Host 'JobTrack Windows build' -ForegroundColor Cyan
Write-Host "  Payload   $Source, jobtrack@$Version"
Write-Host "  ISCC      $iscc"

$started = Get-Date

# ------------------------------------------------------------------------------------ 1. payload

$payloadArgs = @((Join-Path $windowsDir 'scripts/build-payload.mjs'), '--with-mcp')
if ($Source -eq 'Local') { $payloadArgs += '--local' } else { $payloadArgs += @('--version', $Version) }
if ($SkipSmoke) { $payloadArgs += '--skip-smoke' }
if ($KeepDml) { $payloadArgs += '--keep-dml' }
if ($NodeExe) { $payloadArgs += @('--node-exe', $NodeExe) }

Write-Step "Building the payload (node $($payloadArgs -join ' '))"
Push-Location $repoRoot
try {
    Invoke-Native 'build-payload.mjs' { node @payloadArgs }
} finally {
    Pop-Location
}

# The version the payload actually holds, which is what the host and installer must carry.
$launch = Get-Content (Join-Path $payloadDir 'app/launch.json') -Raw | ConvertFrom-Json
$Version = $launch.jobtrackVersion

# --------------------------------------------------------------------------------------- 2. host

# build-payload.mjs wrote windows/version.props, which the csproj imports, so this build carries the
# payload's version.
Write-Step 'Building the tray host'
Invoke-Native 'dotnet publish' {
    dotnet publish (Join-Path $windowsDir 'JobTrack.Host/JobTrack.Host.csproj') `
        -c Release -r win-x64 --self-contained true -o (Join-Path $payloadDir 'host')
}

# ---------------------------------------------------------------------------------- 3. installer

Write-Step 'Building the installer'
Push-Location $installerDir
try {
    Invoke-Native 'ISCC' { & $iscc "/DAppVersion=$Version" 'JobTrack.iss' }
} finally {
    Pop-Location
}

$setup = Join-Path $installerDir "Output/JobTrack-Setup-$Version.exe"
if (-not (Test-Path $setup)) { throw "ISCC finished but $setup is missing." }

$item = Get-Item $setup
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
$elapsed = (Get-Date) - $started

Write-Host ''
Write-Host 'Installer built.' -ForegroundColor Green
Write-Host "  $($item.FullName)"
Write-Host ('  {0:N1} MB, sha256 {1}' -f ($item.Length / 1MB), $hash)
Write-Host ('  jobtrack {0}, api {1}, mcp {2}, node {3}' -f $launch.jobtrackVersion, $launch.apiVersion, $launch.mcpVersion, $launch.nodeVersion)
Write-Host ('  took {0:mm\:ss}' -f $elapsed)
