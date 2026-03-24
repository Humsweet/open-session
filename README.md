[中文](README.zh-CN.md)

# Open Session

A unified dashboard to browse, manage, and inspect your AI coding sessions — across Claude Code, Codex CLI, Copilot CLI, and Gemini CLI.

When you're deep in a vibe-coding spree, sessions pile up — some finished, some abandoned halfway, some still waiting for you to come back. There's no good way to tell them apart.

Open Session borrows the Open/Close idea from GitHub Issues and adds a third state: **Dropped** — for sessions you've decided to abandon. Now you always know exactly which sessions still need your attention, which are done, and which you've written off. For any session you want to resume, copy the session ID or the full resume command with one click and pick up right where you left off.

Beyond status tracking, Open Session reads your session files across all supported tools, normalizes the data, and gives you a single place to search, filter, and actually understand what your AI agents did.

## Features

### Multi-Tool Session Aggregation

Automatically discovers and parses sessions from:

| Tool | Source Path | Format |
|------|-------------|--------|
| Claude Code | `~/.claude/projects/*/` | JSONL |
| Codex CLI | `~/.codex/sessions/` | JSONL |
| Copilot CLI | `~/.copilot/session-state/` | JSONL |
| Gemini CLI | `~/.gemini/` | JSON / Protobuf |

### Deep Agent Process Inspection

For Claude Code sessions, every step of the agent's work is fully visible:

- **Thinking Blocks** — The agent's reasoning process, when available. Older Claude Code versions (< 2.1.81) store full thinking content; newer versions redact it per Anthropic's policy.
- **Tool Calls** — Color-coded by tool (Read, Edit, Bash, Agent, Grep, and more), with expandable parameters and syntax-highlighted JSON.
- **Tool Results** — Collapsible output with success/error indicators and size display.
- **Parallel Call Detection** — Automatically labeled when the agent runs multiple tools simultaneously.
- **Raw JSON Inspector** — Click `{ }` on any block to see the original JSONL entry.

### Session Management

- **Status** — Mark sessions as `Open`, `Closed`, or `Dropped` from the list or detail view.
- **Search & Filter** — Filter by tool, status, or free-text search.
- **Sort** — By last updated or creation time.
- **AI Summary** — Generate session summaries using your local Claude Code, Codex, or Gemini CLI.
- **Resume** — One-click copy of the resume command to pick up where you left off.

## Quick Start

**Prerequisites:** Node.js >= 18 and at least one supported AI coding tool with existing sessions.

```bash
git clone https://github.com/Humsweet/open-session.git
cd open-session
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sessions are discovered automatically.

### Production

```bash
npm run build
npm start
```

## How It Works

```
~/.claude/projects/*/    ─┐
~/.codex/sessions/        ├──▶  Parsers  ──▶  SessionMessage[]  ──▶  Next.js Dashboard
~/.copilot/session-state/ ┤
~/.gemini/               ─┘
                                                      │
                                               SQLite DB
                                        (~/.open-session/data.db)
                                    status, summaries, custom titles
```

1. **Scan** — Parsers scan the filesystem for session files on each request.
2. **Parse** — Each tool's parser normalizes its format into a unified `SessionMessage[]`. Claude's parser extracts rich blocks (thinking, tool_use, tool_result).
3. **Merge** — Session state is persisted in a local SQLite database and merged with parsed data.
4. **Render** — React renders each block type with specialized components.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19 + Tailwind CSS 4 |
| Database | SQLite (better-sqlite3) |
| Icons | Lucide React |
| Language | TypeScript 5 |

Zero external AI dependencies. All data stays local.

## Project Structure

```
src/
├── app/api/sessions/          # REST API routes
├── components/
│   ├── session-detail.tsx     # Detail view
│   ├── message-blocks.tsx     # Thinking, ToolCall, ToolResult, RawJSON, etc.
│   ├── session-card.tsx       # List card with quick-action menu
│   └── filter-bar.tsx         # Filter & sort controls
└── lib/
    ├── parsers/               # Per-tool parsers (claude, codex, copilot, gemini)
    ├── db/                    # SQLite persistence
    └── summarizer/            # AI summary engine
```

## Contributing

Adding support for a new AI tool is straightforward — implement the `SessionParser` interface and wire it into `src/lib/parsers/index.ts`.

## License

MIT
