export type ToolType = 'claude-code' | 'copilot-cli' | 'codex-cli' | 'gemini-cli';
export type SessionStatus = 'open' | 'closed' | 'dropped';
export type SessionOrigin = 'local' | 'slack-bot';

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
  /** Where the active search query matched — only set on search API responses */
  matchedIn?: 'title' | 'summary' | 'message' | 'path' | 'transcript';
  originator?: string;
  agentSource?: string;
  slackThreadTs?: string;
  slackChannelId?: string;
  slackUserId?: string;
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
  scan(): Promise<UnifiedSession[]>;
  getDetail(sessionId: string): Promise<SessionDetail | null>;
}
