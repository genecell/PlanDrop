#
# PlanDrop Native Messaging Host Installer for Windows
# Supports: Chrome, Chromium, Brave, Edge
#
# Usage:
#   .\install.ps1 <extension-id>                    # Single extension
#   .\install.ps1 <id1> <id2> <id3>                 # Multiple extensions (multi-profile)
#

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$ExtensionIds
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$HostScript = Join-Path $ScriptDir "plandrop_host.py"
$ManifestName = "com.plandrop.host"
$BatWrapper = Join-Path $ScriptDir "plandrop_host.bat"

# Handle no arguments or placeholder
if (-not $ExtensionIds -or $ExtensionIds.Count -eq 0) {
    $ExtensionIds = @("EXTENSION_ID_PLACEHOLDER")
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Get-RegistryPath {
    param([string]$Browser)

    switch ($Browser) {
        "chrome"   { return "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$ManifestName" }
        "chromium" { return "HKCU:\Software\Chromium\NativeMessagingHosts\$ManifestName" }
        "brave"    { return "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$ManifestName" }
        "edge"     { return "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$ManifestName" }
    }
}

function Test-BrowserInstalled {
    param([string]$Browser)

    switch ($Browser) {
        "chrome"   { return Test-Path "HKLM:\Software\Google\Chrome" -or Test-Path "${env:ProgramFiles}\Google\Chrome" -or Test-Path "${env:ProgramFiles(x86)}\Google\Chrome" }
        "chromium" { return Test-Path "HKLM:\Software\Chromium" -or (Get-Command chromium -ErrorAction SilentlyContinue) }
        "brave"    { return Test-Path "HKLM:\Software\BraveSoftware\Brave-Browser" -or Test-Path "${env:LOCALAPPDATA}\BraveSoftware\Brave-Browser" }
        "edge"     { return Test-Path "HKLM:\Software\Microsoft\Edge" -or Test-Path "${env:ProgramFiles(x86)}\Microsoft\Edge" }
    }
    return $false
}

function Install-ForBrowser {
    param(
        [string]$Browser,
        [string[]]$ExtensionIds
    )

    $RegistryPath = Get-RegistryPath $Browser

    # Create registry path if needed
    $ParentPath = Split-Path $RegistryPath
    if (-not (Test-Path $ParentPath)) {
        New-Item -Path $ParentPath -Force | Out-Null
    }

    # Build allowed_origins array from all extension IDs
    $AllowedOrigins = @()
    foreach ($Id in $ExtensionIds) {
        $AllowedOrigins += "chrome-extension://$Id/"
    }

    # Create manifest file in script directory
    $ManifestPath = Join-Path $ScriptDir "$ManifestName.json"
    $ManifestContent = @{
        name = $ManifestName
        description = "PlanDrop - Send prompts to remote server via SSH"
        path = $BatWrapper
        type = "stdio"
        allowed_origins = $AllowedOrigins
    } | ConvertTo-Json

    Set-Content -Path $ManifestPath -Value $ManifestContent -Encoding UTF8

    # Set registry key pointing to manifest
    if (Test-Path $RegistryPath) {
        Remove-Item $RegistryPath -Force
    }
    New-Item -Path $RegistryPath -Force | Out-Null
    Set-ItemProperty -Path $RegistryPath -Name "(Default)" -Value $ManifestPath

    Write-Success "Installed for $Browser (registry: $RegistryPath)"
    return $true
}

function Test-Dependencies {
    $Missing = @()

    # Check Python
    $Python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $Python) {
        $Python = Get-Command python3 -ErrorAction SilentlyContinue
    }
    if (-not $Python) {
        $Missing += "python"
    }

    # Check SSH (Windows 10+ has OpenSSH)
    if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
        $Missing += "ssh"
    }

    # Check SCP
    if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
        $Missing += "scp"
    }

    if ($Missing.Count -gt 0) {
        Write-Error "Missing required dependencies: $($Missing -join ', ')"
        Write-Host ""
        Write-Host "Please install:"
        Write-Host "  - Python: https://www.python.org/downloads/"
        Write-Host "  - OpenSSH: Settings > Apps > Optional Features > OpenSSH Client"
        Write-Host ""
        return $false
    }

    Write-Success "All dependencies found (python, ssh, scp)"
    return $true
}

function Create-BatWrapper {
    # Create a batch file wrapper for the Python script
    $PythonPath = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $PythonPath) {
        $PythonPath = (Get-Command python3 -ErrorAction SilentlyContinue).Source
    }

    $BatContent = @"
@echo off
"$PythonPath" "$HostScript" %*
"@

    Set-Content -Path $BatWrapper -Value $BatContent -Encoding ASCII
    Write-Success "Created batch wrapper: $BatWrapper"
}

# Main
Write-Host ""
Write-Host "========================================"
Write-Host "  PlanDrop Native Host Installer"
Write-Host "========================================"
Write-Host ""

# Check host script exists
if (-not (Test-Path $HostScript)) {
    Write-Error "Host script not found: $HostScript"
    exit 1
}

Write-Info "Detected OS: Windows"

# Verify dependencies
if (-not (Test-Dependencies)) {
    exit 1
}

# Create batch wrapper
Create-BatWrapper

# Extension ID warning
if ($ExtensionIds.Count -eq 1 -and $ExtensionIds[0] -eq "EXTENSION_ID_PLACEHOLDER") {
    Write-Host ""
    Write-Warning "No extension ID provided."
    Write-Host "         After loading the extension in Chrome, run:"
    Write-Host "         .\install.ps1 <extension-id>"
    Write-Host ""
    Write-Host "         For multiple profiles/browsers:"
    Write-Host "         .\install.ps1 <chrome-id> <edge-id> <brave-id>"
    Write-Host ""
    Write-Host "         Proceeding with placeholder (you'll need to update later)..."
    Write-Host ""
}
else {
    Write-Info "Using extension ID(s): $($ExtensionIds -join ', ')"
}

# Detect and install for each browser
$Browsers = @("chrome", "chromium", "brave", "edge")
$Installed = @()

Write-Host ""
Write-Info "Checking for installed browsers..."

foreach ($Browser in $Browsers) {
    if (Test-BrowserInstalled $Browser) {
        Write-Info "Found $Browser, installing..."
        if (Install-ForBrowser -Browser $Browser -ExtensionIds $ExtensionIds) {
            $Installed += $Browser
        }
    }
}

Write-Host ""
Write-Host "========================================"
Write-Host "  Installation Summary"
Write-Host "========================================"
Write-Host ""

if ($Installed.Count -eq 0) {
    Write-Warning "No supported browsers detected!"
}
else {
    Write-Success "Installed for: $($Installed -join ', ')"
}

Write-Host ""

# Create log directory
$LogDir = Join-Path $env:USERPROFILE ".plandrop"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
Write-Info "Log file location: $LogDir\relay.log"

Write-Host ""

if (-not ($ExtensionIds.Count -eq 1 -and $ExtensionIds[0] -eq "EXTENSION_ID_PLACEHOLDER")) {
    Write-Host "Next steps:"
    Write-Host "  1. Restart your browser(s)"
    Write-Host "  2. Open the PlanDrop extension popup"
    Write-Host "  3. Configure a server and test the connection"
    Write-Host ""
}

Write-Success "Installation complete!"
