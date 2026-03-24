# Open Session

**A unified dashboard for browsing, managing, and inspecting your AI coding sessions across multiple tools.**

**一个统一的仪表板，用于浏览、管理和检查你在多个 AI 编码工具中的会话记录。**

---

If you vibe-code with Claude Code, Codex CLI, Copilot CLI, or Gemini CLI, your session histories are scattered across hidden directories in different formats. Open Session reads them all, normalizes the data, and gives you a single place to search, filter, review, and understand what your AI agents actually did.

如果你用 Claude Code、Codex CLI、Copilot CLI 或 Gemini CLI 进行 vibe coding，你的会话历史散落在各种隐藏目录中，格式各异。Open Session 读取所有这些数据，统一格式，让你在一个地方搜索、筛选、回顾和理解你的 AI Agent 到底做了什么。

![Session List](docs/screenshot-list.png)

## Features / 功能

### Multi-Tool Aggregation / 多工具聚合

Automatically discovers and parses sessions from:

自动发现并解析以下工具的会话：

| Tool | Source Path | Format |
|------|-----------|--------|
| Claude Code | `~/.claude/projects/*/` | JSONL |
| Codex CLI | `~/.codex/sessions/` | JSONL |
| Copilot CLI | `~/.copilot/session-state/` | JSONL |
| Gemini CLI | `~/.gemini/` | JSON / Protobuf |

### Deep Agent Process Inspection / 深度 Agent 过程检查

For Claude Code sessions, every step of the agent's work is fully visible:

对于 Claude Code 会话，Agent 工作的每一步都完全可见：

- **Thinking Blocks** — See the agent's reasoning process (when available). Older Claude Code versions store full thinking content; newer versions (>= 2.1.81) redact it per Anthropic's policy.
- **Tool Calls** — Color-coded by tool type (Read, Edit, Bash, Agent, Grep, etc.) with expandable parameters and syntax-highlighted JSON.
- **Tool Results** — Collapsible output with success/error indicators and byte-size display.
- **Parallel Calls** — Automatically detected and labeled when the agent runs multiple tools simultaneously.
- **Raw JSON Inspector** — Click `{ }` on any block to see the original JSONL entry for debugging.

- **思考块** — 查看 Agent 的推理过程（如可用）。旧版 Claude Code 存储完整思考内容；新版 (>= 2.1.81) 按 Anthropic 政策不再保存。
- **工具调用** — 按工具类型颜色编码（Read、Edit、Bash、Agent、Grep 等），可展开查看参数和语法高亮 JSON。
- **工具结果** — 可折叠的输出，带成功/错误指示和字节大小显示。
- **并行调用** — 自动检测并标记 Agent 同时运行多个工具的情况。
- **Raw JSON 检查器** — 点击任意块上的 `{ }` 按钮查看原始 JSONL 条目，用于调试。

![Session Detail](docs/screenshot-detail.png)
![Tool Calls](docs/screenshot-tools.png)
![Raw JSON](docs/screenshot-rawjson.png)

### Session Management / 会话管理

- **Status Tracking** — Mark sessions as `Open`, `Closed`, or `Dropped` directly from the list or detail view.
- **Search & Filter** — Filter by tool, status, or text search across titles and content.
- **Sort** — Sort by last updated or creation time.
- **AI Summary** — Generate session summaries using your local AI CLI (Claude Code, Codex, or Gemini).
- **Resume** — One-click copy of the resume command to continue a session.

- **状态追踪** — 在列表或详情页直接将会话标记为 `Open`、`Closed` 或 `Dropped`。
- **搜索和筛选** — 按工具、状态或文本搜索标题和内容。
- **排序** — 按最后更新时间或创建时间排序。
- **AI 摘要** — 使用本地 AI CLI（Claude Code、Codex 或 Gemini）生成会话摘要。
- **恢复会话** — 一键复制恢复命令以继续会话。

## Quick Start / 快速开始

### Prerequisites / 前提条件

- **Node.js** >= 18
- At least one AI coding tool with existing sessions (Claude Code, Codex CLI, Copilot CLI, or Gemini CLI)
- 至少安装了一个 AI 编码工具并有现有会话记录

### Installation / 安装

```bash
# Clone the repository / 克隆仓库
git clone https://github.com/Humsweet/open-session.git
cd open-session

# Install dependencies / 安装依赖
npm install

# Start the development server / 启动开发服务器
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Your sessions will be automatically discovered.

在浏览器中打开 [http://localhost:3000](http://localhost:3000)，你的会话将被自动发现。

### Production Build / 生产构建

```bash
npm run build
npm start
```

## How It Works / 工作原理

```
~/.claude/projects/*/   ─┐
~/.codex/sessions/       ├──▶  Parsers  ──▶  Unified Data Model  ──▶  Next.js Dashboard
~/.copilot/session-state/┤                    (SessionMessage[])       (React Components)
~/.gemini/               ─┘
                                                    │
                                              SQLite DB
                                          (~/.open-session/data.db)
                                          stores: status, summaries,
                                          custom titles
```

1. **Scan** — On each request, parsers scan the filesystem for session files.
2. **Parse** — Each tool's parser normalizes its format into a unified `SessionMessage[]` array. Claude's parser extracts rich blocks (thinking, tool_use, tool_result).
3. **Merge** — Session state (status, summaries) is persisted in a local SQLite database and merged with parsed data.
4. **Render** — The React frontend renders the data with specialized components for each block type.

## Tech Stack / 技术栈

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19 + Tailwind CSS 4 |
| Database | SQLite (better-sqlite3) |
| Icons | Lucide React |
| Language | TypeScript 5 |

Zero external AI dependencies. All data stays local. No cloud, no accounts, no telemetry.

零外部 AI 依赖。所有数据保持本地。无云端、无账户、无遥测。

## Project Structure / 项目结构

```
src/
├── app/
│   ├── api/sessions/          # REST API routes
│   └── sessions/[id]/         # Detail page
├── components/
│   ├── session-list.tsx       # Session list view
│   ├── session-detail.tsx     # Detail view with rich rendering
│   ├── message-blocks.tsx     # Block components (Thinking, ToolCall, etc.)
│   ├── filter-bar.tsx         # Filter & sort controls
│   └── session-card.tsx       # List card with status menu
└── lib/
    ├── parsers/               # Per-tool parsers
    │   ├── claude-parser.ts   # Rich block extraction
    │   ├── codex-parser.ts
    │   ├── copilot-parser.ts
    │   └── gemini-parser.ts
    ├── db/                    # SQLite persistence
    └── summarizer/            # AI summary engine
```

## Contributing / 贡献

Contributions are welcome. If you use an AI coding tool that isn't supported yet, adding a new parser is straightforward — implement the `SessionParser` interface and wire it into `src/lib/parsers/index.ts`.

欢迎贡献。如果你使用的 AI 编码工具尚未支持，添加新的解析器很简单——实现 `SessionParser` 接口并在 `src/lib/parsers/index.ts` 中注册即可。

## License / 许可

MIT
