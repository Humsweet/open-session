export type ToolType = 'claude-code' | 'copilot-cli' | 'codex-cli' | 'gemini-cli';
export type SessionStatus = 'open' | 'closed';
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
  rawPath: string;
  origin: SessionOrigin;
  agentSource?: string;
  slackThreadTs?: string;
  slackUserId?: string;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  toolName?: string;
}

export interface SessionDetail extends UnifiedSession {
  messages: SessionMessage[];
}

export interface SessionParser {
  scan(): Promise<UnifiedSession[]>;
  getDetail(sessionId: string): Promise<SessionDetail | null>;
}
