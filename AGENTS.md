# AGENTS.md — open-session 运维注意事项

> ⚠️ 本文档描述的是 **macOS** 上的运维流程（pm2 + launchd），Windows 上不适用。

## 服务管理

open-session 通过 **pm2** 常驻后台运行，使用生产构建（`npm start`），并已注册为 macOS launchd 服务（登录后自动启动）。

访问地址：http://localhost:3001

## 更新代码后的正确流程

代码有任何改动后，必须按以下顺序操作，**不要直接 restart**：

```bash
cd "~/Github Personal/open-session"
npm run build
pm2 restart open-session
```

## 常用 pm2 命令

```bash
pm2 status                 # 查看服务状态
pm2 logs open-session      # 查看运行日志
pm2 restart open-session   # 重启服务（需先 build）
pm2 stop open-session      # 停止服务
pm2 start open-session     # 启动服务
```

## 注意事项

- 运行模式是 **production**，不支持热重载，改完代码必须 build 再 restart
- pm2 进程列表已通过 `pm2 save` 持久化，重启 Mac 后自动恢复
- 如果 Node.js 版本升级，需重新执行 `pm2 startup` 并重新注册 launchd
