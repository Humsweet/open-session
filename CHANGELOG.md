# Changelog

## [0.2.0] - 2026-04-05

### Fixed
- 修复 session 状态修改后刷新页面变回 Open 的 bug（SQLite `datetime('now')` 无时区标记导致 JS 解析偏移 8 小时，触发误判 auto-reopen）
- 修复卡片操作下拉菜单被下方卡片遮挡、被容器 overflow 裁切的 bug

### Added
- 卡片状态变更后动画退出列表（opacity + max-height 渐变，400ms）
- localStorage 缓存 + Stale-While-Revalidate：再次打开页面瞬间显示上次列表，无加载等待

## [0.1.0] - 2026-03-12

### Added
- 初始版本：跨工具 Vibe Coding Session 管理 Dashboard
- 支持 4 个 AI 编码工具的 session 扫描：Claude Code、Copilot CLI、Codex CLI、Gemini CLI
- Session 列表页：工具筛选、状态筛选（Open/Closed）、搜索功能
- Session 详情页：消息时间线、元信息展示、状态切换
- AI 摘要引擎：通过本地 CLI（Claude/Codex/Gemini）生成 session 摘要，零 API 费用
- Settings 页：摘要引擎选择
- Linear 风格暗色主题 UI
- SQLite 本地持久化（session 状态、摘要、设置）
