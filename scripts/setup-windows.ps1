#!/usr/bin/env pwsh
# setup-windows.ps1 - One-time Windows setup script
# Run after fresh clone or machine change. Does:
#   1. Install git hooks (post-merge / post-rewrite)
#   2. Add server to Windows Startup folder (auto-start at login)
#   3. Start server immediately if not already running
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1

$ErrorActionPreference = "Stop"
$REPO = "C:\Users\yuyang.han\Github Personal\open-session"

# -- 1. Git hooks --
Write-Host "[setup] Installing git hooks..."
$hooksDir = Join-Path $REPO ".git\hooks"
$psScript = Join-Path $REPO "scripts\reconcile-server.ps1"
$hookLine = "powershell.exe -NonInteractive -ExecutionPolicy Bypass -File `"$psScript`""
$hookBody = "#!/bin/sh`n$hookLine`n"
[System.IO.File]::WriteAllText("$hooksDir\post-merge",   $hookBody)
[System.IO.File]::WriteAllText("$hooksDir\post-rewrite", $hookBody)
Write-Host "[setup] OK: post-merge, post-rewrite installed"

# -- 2. Auto-start at login (Windows Startup folder shortcut) --
Write-Host "[setup] Configuring auto-start..."
$startupDir  = [System.Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "open-session.lnk"

$wsh = New-Object -ComObject WScript.Shell
$sc  = $wsh.CreateShortcut($shortcutPath)
$sc.TargetPath       = "powershell.exe"
$sc.Arguments        = "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"Set-Location '$REPO'; npm start`""
$sc.WorkingDirectory = $REPO
$sc.WindowStyle      = 7
$sc.Description      = "open-session server (port 3001)"
$sc.Save()
Write-Host "[setup] OK: startup shortcut -> $shortcutPath"

# -- 3. Start server immediately if not running --
$conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if (-not $conn) {
    Write-Host "[setup] Starting server..."
    Start-Process powershell `
        -WindowStyle Hidden `
        -ArgumentList "-NonInteractive -ExecutionPolicy Bypass -Command `"Set-Location '$REPO'; npm start`""
    Start-Sleep -Seconds 5
    $conn2 = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
    if ($conn2) { Write-Host "[setup] OK: server running on http://localhost:3001 (PID $($conn2.OwningProcess))" }
    else        { Write-Host "[setup] WARN: server starting, check http://localhost:3001 in a moment" }
} else {
    Write-Host "[setup] OK: server already running (PID $($conn.OwningProcess))"
}

Write-Host ""
Write-Host "Setup complete. Server will auto-start on next login."
Write-Host "Manual rebuild: powershell -File scripts\reconcile-server.ps1"
