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

## AI Agent Sessions 备份(外置 SSD 归档)

Claude Code 默认 `cleanupPeriodDays=30`,启动时自动删 30 天前的 session transcript;
Codex / Gemini 等也各有清理。`scripts/backup-sessions.sh` 在清理删掉之前,把各源
**只增不删、幂等增量**地镜像到备份盘,让历史永不丢失,并能在 open-session 里
以「Archived (SSD)」来源回看。

> **⚠️ 备份根说明(机器相关 · 传输不定)**:`/Volumes/Extreme SSD/…` 指向的物理硬盘接在
> mac-mini 上。**在 mac-mini 本机是本地外置 SSD;在任何其他机器上都是经网络远程挂载**——
> 网络路径不定(局域网 SMB、Tailscale、或断开),**响应快慢无保证,随时可能卡住**。因此代码
> 必须把这个备份根**当作随时可能停顿的远程挂载**来对待:绝不在请求路径上对它做阻塞式同步 fs,
> 否则挂载一卡会焊死单线程 server(2026-07-23 真实踩坑:一次网络挂载停顿把整个 server——含
> 静态首页——全部卡成无限等待、node 0% CPU;用 `sample <pid>` 抓到卡在 `node::fs::Stat`)。
> 正本见 `src/lib/parsers/session-roots.ts` 的异步 liveness 探测(`fs.promises.readdir` race
> 1.5 秒超时,卡住/超时/未挂载一律判不可用并跳过归档,请求路径永不在挂载上做同步 fs)。
> 远程挂载不会自动重挂,需要时手动重连。

- 备份脚本:`scripts/backup-sessions.sh`(zsh,可独立于 node 运行,供定时器调用)
- 备份根:`/Volumes/Extreme SSD/Backup/AI Agent Sessions`(可用环境变量
  `OPEN_SESSION_BACKUP_ROOT` 覆盖)。**单一真相源**:脚本里的默认值与
  `src/lib/parsers/session-roots.ts` 的 `DEFAULT_BACKUP_ROOT` 必须一致,换盘只改这两处。
- 布局(parser 友好,open-session 用同一套 parser、只换个根来读):
  `claude/projects`、`codex/sessions`、`copilot/session-state`、`gemini/{tmp,antigravity}`
- 同步策略:`rsync -a --update`(**绝无 `--delete`**)—— 源更新(jsonl 追加变大)同步过去,
  源被清理删掉的文件在备份里**原样保留**。
- 失败边界:SSD 未挂载时脚本 `exit 2` 并清晰报错,绝不报「成功」、绝不写进未挂载占位目录。
- 日志:`~/Library/Logs/open-session-backup.log`;每次跑还在备份根落一份 `MANIFEST.txt`。
- 手动跑:`scripts/backup-sessions.sh`(幂等,可随时重复跑)。

### 定时运行(可选,由你决定是否启用)

`scripts/com.hanyuyang.open-session-backup.plist.template` 是 LaunchAgent 模板(默认每天 03:00)。
**不会自动安装** —— 只有定期跑才能在清理前抢救数据,但是否上系统级定时器交给你决定:

```bash
REPO="$(pwd)"   # 在仓库根目录执行
sed -e "s|__REPO__|$REPO|g" -e "s|__HOME__|$HOME|g" \
  scripts/com.hanyuyang.open-session-backup.plist.template \
  > ~/Library/LaunchAgents/com.hanyuyang.open-session-backup.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hanyuyang.open-session-backup.plist
```

### open-session 里看归档

各 parser 现在按「本地源 + 备份盘(挂载时)」多根扫描(SSOT 在
`src/lib/parsers/session-roots.ts`)。同一 session id 在本地与备份都存在时,
`src/lib/parsers/index.ts` 的去重逻辑只显示一条,且优先显示**活的本地副本**;
只存在于备份(本地已被清理)的历史 session 会以 `archived` 标记呈现,列表/详情页打上
「Archived (SSD)」徽章。SSD 没挂载时备份根自动从扫描中消失,只显示本地,不报错。

## 注意事项

- 运行模式是 **production**,不支持热重载,代码改动必须 build 再 restart —— pull 时由 hook 自动完成;本机直接改代码后手动跑 reconcile 脚本。
- Node.js 版本升级后,若依赖需重装,reconcile 会在下次 lockfile 变化时 `npm ci`。
- 构建产物对应的 commit 记录在 `.git/open-session-built-commit`(机器本地,不入库),供 reconcile 判断是否需要重建。