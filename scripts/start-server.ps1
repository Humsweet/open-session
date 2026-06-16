#!/usr/bin/env pwsh
# start-server.ps1 — Task Scheduler 启动入口
# 由 Windows Task Scheduler "open-session" 任务调用；不要直接运行。

$REPO = Split-Path -Parent $PSScriptRoot
Set-Location $REPO
& npm start
