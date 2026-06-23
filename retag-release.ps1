#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Re-tag a release and push it, triggering the Release workflow.

.DESCRIPTION
    Reads the version from package.json (unless -Version is given), resolves the
    target commit (HEAD by default, or -Sha), then:
      1. Deletes the remote tag
      2. Force-moves the local tag to the target commit
      3. Pushes the tag

.PARAMETER Version
    Tag version without the leading 'v'. Defaults to the value in package.json.

.PARAMETER Sha
    Commit to point the tag at. Defaults to current HEAD.

.PARAMETER Remote
    Remote name. Defaults to 'origin'.

.EXAMPLE
    ./retag-release.ps1
    Re-tags v<package.json version> at HEAD and pushes.

.EXAMPLE
    ./retag-release.ps1 -Version 0.1.1 -Sha abc1234
#>
[CmdletBinding()]
param(
    [string]$Version,
    [string]$Sha,
    [string]$Remote = "origin"
)

$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
Push-Location $repoRoot
try {
    if (-not $Version) {
        $pkg = Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
        $Version = $pkg.version
        if (-not $Version) { throw "Could not read version from package.json" }
    }

    if (-not $Sha) {
        $Sha = (git rev-parse HEAD).Trim()
    } else {
        $Sha = (git rev-parse $Sha).Trim()
    }

    $tag = "v$Version"
    Write-Host "Retagging $tag -> $Sha on remote '$Remote'" -ForegroundColor Cyan

    # 1. Delete remote tag (ignore failure if it doesn't exist).
    Write-Host "git push $Remote :refs/tags/$tag"
    git push $Remote ":refs/tags/$tag" 2>&1 | Write-Host
    # Don't throw on missing remote tag — just continue.

    # 2. Force-move local tag.
    Write-Host "git tag -f $tag $Sha"
    git tag -f $tag $Sha
    if ($LASTEXITCODE -ne 0) { throw "git tag failed" }

    # 3. Push the tag.
    Write-Host "git push $Remote $tag"
    git push $Remote $tag
    if ($LASTEXITCODE -ne 0) { throw "git push failed" }

    Write-Host "`nDone. Tag $tag now points at $Sha." -ForegroundColor Green
    Write-Host "The Release workflow should be running: https://github.com/<owner>/<repo>/actions"
} finally {
    Pop-Location
}
