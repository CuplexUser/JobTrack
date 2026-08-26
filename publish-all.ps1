<#
.SYNOPSIS
    Publishes all four JobTrack npm packages, in dependency order, with one confirmation
    prompt up front.

.DESCRIPTION
    Order matters: apps/api depends on @jobtrack/shared, and apps/mcp/apps/tray both depend
    on @jobtrack/api. See docs/publishing.md for the full picture. Requires `npm login`
    beforehand — this script doesn't handle authentication.

.PARAMETER DryRun
    Runs `npm pack --dry-run` instead of `npm publish` for each package — lists what would be
    published without touching the registry, and skips the confirmation prompt.

.EXAMPLE
    ./publish-all.ps1
    ./publish-all.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# Publish order: @jobtrack/shared first (apps/api depends on it), then @jobtrack/api (both
# apps/mcp and apps/tray depend on it), then the two leaf packages.
$packageDirs = @(
    'packages/shared',
    'apps/api',
    'apps/mcp',
    'apps/tray'
)

$repoRoot = $PSScriptRoot

$packages = foreach ($dir in $packageDirs) {
    $fullPath = Join-Path $repoRoot $dir
    $manifestPath = Join-Path $fullPath 'package.json'
    if (-not (Test-Path $manifestPath)) {
        throw "No package.json found at $manifestPath"
    }
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    [pscustomobject]@{
        Dir     = $fullPath
        Name    = $manifest.name
        Version = $manifest.version
    }
}

Write-Host ''
Write-Host 'Packages to publish (in this order):' -ForegroundColor Cyan
$packages | ForEach-Object { Write-Host "  $($_.Name)@$($_.Version)" }
Write-Host ''

if (-not $DryRun) {
    $whoami = npm whoami 2>$null
    if (-not $whoami) {
        throw "Not logged in to npm. Run 'npm login' first."
    }
    Write-Host "Publishing as: $whoami" -ForegroundColor Cyan
    Write-Host ''

    $answer = Read-Host "Publish all $($packages.Count) packages to npm? This is irreversible — a published version can never be overwritten. Type 'yes' to continue"
    if ($answer -ne 'yes') {
        Write-Host 'Aborted — nothing was published.' -ForegroundColor Yellow
        exit 0
    }
    Write-Host ''
}

foreach ($pkg in $packages) {
    Write-Host "==> $($pkg.Name)@$($pkg.Version)" -ForegroundColor Cyan
    Push-Location $pkg.Dir
    try {
        if ($DryRun) {
            npm pack --dry-run
        } else {
            npm publish --access public
        }
        if ($LASTEXITCODE -ne 0) {
            throw "npm exited with code $LASTEXITCODE while processing $($pkg.Name)"
        }
    } finally {
        Pop-Location
    }
    Write-Host ''
}

if ($DryRun) {
    Write-Host 'Dry run complete — nothing was published.' -ForegroundColor Green
} else {
    Write-Host 'All packages published.' -ForegroundColor Green
}
