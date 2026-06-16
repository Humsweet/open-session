#!/usr/bin/env pwsh
# reconcile-server.ps1 — Windows 版本
# 把运行中的 open-session server 收敛到当前 git HEAD。
# 逻辑同 reconcile-server.sh（macOS 版），差异仅在服务管理层：
#   macOS  → launchctl kickstart
#   Windows → Start-Process -WindowStyle Hidden（后台独立进程）
#
#   · 幂等   — 产物已对应当前 HEAD 时空跑，重复调用安全
#   · 增量   — 仅 lockfile 变化才 npm ci
#   · 失败边界 — build 失败时保留旧 server 不动

param()
$ErrorActionPreference = "Stop"

$REPO  = "C:\Users\yuyang.han\Github Personal\open-session"
$STAMP = Join-Path $REPO ".git\open-session-built-commit"

Set-Location $REPO

$headCommit  = (git rev-parse HEAD 2>&1).ToString().Trim()
$builtCommit = if (Test-Path $STAMP) { (Get-Content $STAMP -Raw).Trim() } else { "none" }

# —— 幂等门 ——
if ($headCommit -eq $builtCommit -and (Test-Path "node_modules\.bin\next.cmd")) {
    Write-Host "[reconcile] 已是最新 ($($headCommit.Substring(0,8)))，无需重建"
    exit 0
}

$builtShort = if ($builtCommit -eq "none") { "none" } else { $builtCommit.Substring(0, [Math]::Min(8, $builtCommit.Length)) }
Write-Host "[reconcile] 收敛: 已构建 $builtShort  →  目标 HEAD $($headCommit.Substring(0,8))"

# —— 依赖检查（增量）——
$needInstall = $false
if (-not (Test-Path "node_modules\.bin\next.cmd") -or -not (Test-Path "node_modules\.bin\cross-env.cmd")) {
    $needInstall = $true
} elseif ($builtCommit -ne "none") {
    git diff --quiet $builtCommit $headCommit -- package-lock.json 2>$null
    if ($LASTEXITCODE -ne 0) { $needInstall = $true }
}

if ($needInstall) {
    Write-Host "[reconcile] 依赖变化，npm ci ..."
    npm ci
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[reconcile] npm ci 失败 → 保留旧 server 不动，未重启" -ForegroundColor Red
        exit 1
    }
}

# —— 构建 ——
Write-Host "[reconcile] 构建 npm run build ..."
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[reconcile] 构建失败 → 旧 server 继续服务，未重启。修正后重跑本脚本。" -ForegroundColor Red
    exit 1
}

# —— 重启 ——
Write-Host "[reconcile] 构建成功，重启 server ..."

# 停掉旧进程（port 3001）
$conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    [System.Diagnostics.Process]::GetProcessById([int]$conn.OwningProcess).Kill()
    Start-Sleep -Seconds 1
}

# 以后台独立进程方式启动（窗口隐藏，脱离当前 session）
Start-Process powershell `
    -WindowStyle Hidden `
    -ArgumentList "-NonInteractive -ExecutionPolicy Bypass -Command `"Set-Location '$REPO'; npm start`""

$headCommit | Out-File -FilePath $STAMP -NoNewline -Encoding utf8
Write-Host "[reconcile] 完成: server 现服务于 $($headCommit.Substring(0,8))"
