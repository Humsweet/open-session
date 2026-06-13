# AGENTS.md — open-session 运维注意事项

> ⚠️ 本文档描述的是 **macOS** 上的运维流程（launchd），Windows 上不适用。

## 服务管理

open-session 用 **launchd** 常驻运行,跑生产构建（`next start`,端口 3001）。
LaunchAgent `com.hanyuyang.open-session` 已注册（`RunAtLoad` + `KeepAlive`）:登录自启,崩溃自动重拉。

- 访问地址:http://localhost:3001
- LaunchAgent plist:`~/Library/LaunchAgents/com.hanyuyang.open-session.plist`
- 实际启动入口:`~/dotfiles/scripts/launchers/open-session`(直接 `npm start`,**不经 pm2**)
- 运行日志:`~/Library/Logs/open-session.log`

> 历史说明:早期文档写的是 pm2 守护,现已**不再使用 pm2**(本机未安装)。守护改由 launchd 直接拉起 `npm start`。

## 更新代码后:不用手动操作

本机装了 git hook,**`git pull` 后会自动重建并重启 server** —— 你正常 pull 就行,无需手动 build/restart。

机制(单一真相源,逻辑只在一处):

- `scripts/reconcile-server.sh` —— 把「运行中的 server」收敛到「当前 HEAD」。幂等(已是 HEAD 就空跑)、增量(仅 lockfile 变了才 `npm ci`)、失败边界(build 失败则保留旧 server 不重启)。
- `.git/hooks/post-merge` + `.git/hooks/post-rewrite` —— 两个极薄的桩,pull(merge / rebase 都覆盖)后自动调用上面的脚本。hook 在 `.git/` 内,不随 git 同步,这是对的:「我是 server host」是本机专属角色。

> 为什么需要重建而不只是重启:`next start` 服务的是预构建的 `.next` 产物。pull 进新源码后,不 `build` 则 server 仍服务旧产物 —— reconcile 脚本正是消除这个「产物 vs 源码」漂移。

### 手动场景

```bash
cd "~/Github Personal/open-session"
./scripts/reconcile-server.sh        # 按当前代码重建+重启(等价于 hook 自动做的事)
```

构建出错时脚本会保留旧 server 并打印错误,修正后重跑即可。

## 常用 launchd 命令

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

- 运行模式是 **production**,不支持热重载,代码改动必须 build 再 restart —— pull 时由 hook 自动完成;本机直接改代码后手动跑 `./scripts/reconcile-server.sh`。
- Node.js 版本升级后,若依赖需重装,reconcile 会在下次 lockfile 变化时 `npm ci`;launchd 注册不受 Node 版本影响,无需重做。
- 构建产物对应的 commit 记录在 `.git/open-session-built-commit`(机器本地,不入库),供 reconcile 判断是否需要重建。
