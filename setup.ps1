# Ticket Control - Windows Setup Script
# Run this script in PowerShell as Administrator

$ErrorActionPreference = "Stop"

Write-Host "=== Ticket Control - Windows Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# Check if WSL is available
$wslInstalled = $false
try {
    $wslOutput = wsl --status 2>&1
    if ($LASTEXITCODE -eq 0) {
        $wslInstalled = $true
    }
} catch {
    $wslInstalled = $false
}

if (-not $wslInstalled) {
    Write-Host "WSL is not installed." -ForegroundColor Yellow

    if (-not $isAdmin) {
        Write-Host "ERROR: Administrator privileges are required to install WSL." -ForegroundColor Red
        Write-Host "Please re-run this script as Administrator:" -ForegroundColor Yellow
        Write-Host "  Right-click PowerShell -> Run as Administrator" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "Installing WSL..." -ForegroundColor Yellow
    wsl --install --no-distribution
    Write-Host ""
    Write-Host "WSL has been installed. A restart may be required." -ForegroundColor Green
    Write-Host "After restarting, run this script again to complete setup." -ForegroundColor Yellow
    Write-Host ""
    $restart = Read-Host "Would you like to restart now? (y/n)"
    if ($restart -eq "y") {
        Restart-Computer -Force
    }
    exit 0
}

Write-Host "WSL is installed." -ForegroundColor Green

# Check if a WSL distribution is available
$distros = wsl --list --quiet 2>&1 | Where-Object { $_ -and $_ -notmatch "^Windows" }
if (-not $distros -or $distros.Count -eq 0) {
    Write-Host "No WSL distribution found. Installing Ubuntu..." -ForegroundColor Yellow

    if (-not $isAdmin) {
        Write-Host "ERROR: Administrator privileges are required to install a WSL distribution." -ForegroundColor Red
        Write-Host "Please re-run this script as Administrator." -ForegroundColor Yellow
        exit 1
    }

    wsl --install -d Ubuntu
    Write-Host "Ubuntu has been installed. You may need to set up a username/password." -ForegroundColor Green
    Write-Host "After setup completes, run this script again." -ForegroundColor Yellow
    exit 0
}

Write-Host "WSL distribution found." -ForegroundColor Green

# Check if Node.js is available in WSL
$nodeCheck = wsl bash -c "command -v node" 2>&1
if (-not $nodeCheck -or $nodeCheck -match "not found") {
    Write-Host "Node.js not found in WSL. Installing via nvm..." -ForegroundColor Yellow
    wsl bash -c "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && export NVM_DIR=`$HOME/.nvm && [ -s `$NVM_DIR/nvm.sh ] && . `$NVM_DIR/nvm.sh && nvm install --lts"
    Write-Host "Node.js installed in WSL." -ForegroundColor Green
}

# Convert Windows path to WSL path and run setup.sh
$winPath = (Get-Item -Path $PSScriptRoot).FullName
$wslPath = wsl wslpath -u "$winPath"

Write-Host ""
Write-Host "Running setup.sh in WSL..." -ForegroundColor Cyan
Write-Host ""

wsl bash -c "cd $wslPath && chmod +x setup.sh && bash setup.sh"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "=== Windows Setup Complete ===" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Setup encountered errors. Check the output above." -ForegroundColor Red
    exit 1
}
