# AGENTS.md — open-session 运维注意事项

> 本文档同时覆盖 **macOS**（launchd）和 **Windows**（Startup 文件夹 + Start-Process）两套流程。

## macOS 服务管理

open-session 用 **launchd** 常驻运行,跑生产构建（`next start`,端口 3001）。
LaunchAgent `com.hanyuyang.open-session` 已注册（`RunAtLoad` + `KeepAlive`）:登录自启,崩溃自动重拉。

- 访问地址:http://localhost:3001
- LaunchAgent plist:`~/Library/LaunchAgents/com.hanyuyang.open-session.plist`
- 实际启动入口:`~/dotfiles/scripts/launchers/open-session`(直接 `npm start`,**不经 pm2**)
- 运行日志:`~/Library/Logs/open-session.log`

> 历史说明:早期文档写的是 pm2 守护,现已**不再使用 pm2**(本机未安装)。守护改由 launchd 直接拉起 `npm start`。

## Windows 服务管理

open-session 用 **Windows Startup 文件夹快捷方式** 实现登录自启，进程通过 `Start-Process -WindowStyle Hidden` 在后台独立运行（脱离终端 session）。

- 访问地址:http://localhost:3001
- Startup 快捷方式:`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\open-session.lnk`
- reconcile 脚本:`scripts\reconcile-server.ps1`（幂等、增量、失败边界，与 macOS 版逻辑相同）

### 初次配置（新 clone / 换机）

```powershell
# 在仓库根目录运行，一次性完成：hooks + 自启快捷方式 + 立即启动
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
```

### 手动重建

```powershell
powershell -ExecutionPolicy Bypass -File scripts\reconcile-server.ps1
```

### 常用 Windows 命令

```powershell
# 查看 server 进程
Get-NetTCPConnection -LocalPort 3001 -State Listen | Select-Object OwningProcess

# 停止 server（先查 PID，再 kill）
[System.Diagnostics.Process]::GetProcessById(<PID>).Kill()

# 重新启动 server（后台隐藏窗口）
$r = "C:\Users\yuyang.han\Github Personal\open-session"
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NonInteractive -ExecutionPolicy Bypass -Command `"Set-Location '$r'; npm start`""
```

## 更新代码后:不用手动操作

两台机器都装了 git hook，**`git pull` 后会自动重建并重启 server**。

机制(单一真相源,逻辑只在一处):

- macOS：`scripts/reconcile-server.sh` → `launchctl kickstart`
- Windows：`scripts/reconcile-server.ps1` → `Start-Process -WindowStyle Hidden`
- `.git/hooks/post-merge` + `.git/hooks/post-rewrite` —— 两个极薄的桩，pull 后自动调用对应脚本。hook 在 `.git/` 内,不随 git 同步：「我是 server host」是本机专属角色。

> 为什么需要重建而不只是重启:`next start` 服务的是预构建的 `.next` 产物。pull 进新源码后,不 `build` 则 server 仍服务旧产物 —— reconcile 脚本正是消除这个「产物 vs 源码」漂移。

## macOS 常用 launchd 命令

```bash
SVC=com.hanyuyang.open-session
launchctl print gui/$(id -u)/$SVC               # 查看状态 / last exit code
launchctl kickstart -k gui/$(id -u)/$SVC        # 强制重启(reconcile 内部即用此)
launchctl kill TERM gui/$(id -u)/$SVC           # 停止(KeepAlive 会再拉起;要真停需 bootout)
launchctl bootout gui/$(id -u)/$SVC             # 注销服务(停止且不再自启)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$SVC.plist   # 重新注册
tail -f ~/Library/Logs/open-session.log         # 看运行日志
lsof -nP -iTCP:3001 -sTCP:LISTEN                # 确认 3001 在监听
```

## 注意事项

- 运行模式是 **production**,不支持热重载,代码改动必须 build 再 restart —— pull 时由 hook 自动完成;本机直接改代码后手动跑 reconcile 脚本。
- Node.js 版本升级后,若依赖需重装,reconcile 会在下次 lockfile 变化时 `npm ci`。
- 构建产物对应的 commit 记录在 `.git/open-session-built-commit`(机器本地,不入库),供 reconcile 判断是否需要重建。