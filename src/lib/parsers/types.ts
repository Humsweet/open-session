import type { HostFilter } from './session-roots';

export type ToolType = 'claude-code' | 'copilot-cli' | 'codex-cli' | 'gemini-cli';
export type SessionStatus = 'open' | 'closed' | 'dropped';
export type SessionOrigin = 'local' | 'slack-bot' | 'i2m';

export interface UnifiedSession {
  id: string;
  tool: ToolType;
  status: SessionStatus;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  firstUserMessage: string;
  lastUserMessage: string;
  summary?: string;
  summaryTitleApplied?: boolean;
  pinned?: boolean;
  rawPath: string;
  origin: SessionOrigin;
  /** True when the copy backing this session lives on the backup/archive root
   * (external SSD), not the live local source. Set when a session exists only
   * in the backup (already cleaned up locally) or when the backup copy is the
   * one chosen during dedup. Drives the "Archived (SSD)" provenance badge. */
  archived?: boolean;
  /** Which host this session's transcript belongs to. Unset/undefined means the
   * local machine; 'mac-mini' means it came from the mac-mini mirror root
   * (scripts/mirror-mac-mini.sh). Used to keep remote-host sessions out of the
   * local main list by default (see /api/sessions host filter). */
  host?: string;
  /** Where the active search query matched — only set on search API responses */
  matchedIn?: 'title' | 'summary' | 'message' | 'path' | 'transcript';
  originator?: string;
  agentSource?: string;
  slackThreadTs?: string;
  slackChannelId?: string;
  slackUserId?: string;
  /** Token usage + cost from ccusage (see src/lib/usage), when cached. Claude
   * Code sessions only for now — see the mapping note in ccusage-client.ts. */
  usage?: {
    totalTokens: number;
    costUsd: number;
    model: string;
  };
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  toolName?: string;
  // Rich block fields (populated by Claude parser)
  blockType?: 'text' | 'thinking' | 'tool_call' | 'tool_result';
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
  isError?: boolean;
  isRedacted?: boolean;
  /** Index of the source JSONL line (in the trim-filtered file), so the raw
   * entry can be fetched on demand instead of shipped with every message. */
  rawIndex?: number;
}

export interface SessionDetail extends UnifiedSession {
  messages: SessionMessage[];
}

export interface SessionParser {
  /** Scan sessions for the given host filter. Defaults to 'all'; callers that
   * want only this machine pass 'local' so remote-host roots aren't even opened. */
  scan(hostFilter?: HostFilter): Promise<UnifiedSession[]>;
  getDetail(sessionId: string): Promise<SessionDetail | null>;
}
