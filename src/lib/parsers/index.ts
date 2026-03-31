import { ClaudeParser } from './claude-parser';
import { CopilotParser } from './copilot-parser';
import { CodexParser } from './codex-parser';
import { GeminiParser } from './gemini-parser';
import { UnifiedSession, SessionDetail, ToolType } from './types';
import { enrichSessionDetailWithAgentRemote, enrichSessionsWithAgentRemote } from '../agent-remote';

const parsers = {
  'claude-code': new ClaudeParser(),
  'copilot-cli': new CopilotParser(),
  'codex-cli': new CodexParser(),
  'gemini-cli': new GeminiParser(),
};

function pickPreferredSession(current: UnifiedSession | undefined, candidate: UnifiedSession): UnifiedSession {
  if (!current) return candidate;

  const currentUpdatedAt = new Date(current.updatedAt).getTime();
  const candidateUpdatedAt = new Date(candidate.updatedAt).getTime();

  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt ? candidate : current;
  }

  return candidate.messageCount > current.messageCount ? candidate : current;
}

export async function scanAllSessions(toolFilter?: ToolType): Promise<UnifiedSession[]> {
  const tools = toolFilter ? [toolFilter] : Object.keys(parsers) as ToolType[];
  const results = await Promise.all(
    tools.map(tool => parsers[tool].scan().catch(() => [] as UnifiedSession[]))
  );

  const deduped = new Map<string, UnifiedSession>();
  for (const session of results.flat()) {
    deduped.set(session.id, pickPreferredSession(deduped.get(session.id), session));
  }

  const sessions = [...deduped.values()].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return enrichSessionsWithAgentRemote(sessions);
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const tool = sessionId.split('-')[0] as string;
  const toolMap: Record<string, ToolType> = {
    claude: 'claude-code',
    copilot: 'copilot-cli',
    codex: 'codex-cli',
    gemini: 'gemini-cli',
  };
  const toolType = toolMap[tool];
  if (!toolType || !parsers[toolType]) return null;
  const detail = await parsers[toolType].getDetail(sessionId);
  if (!detail) return null;
  return enrichSessionDetailWithAgentRemote(detail);
}

export type { UnifiedSession, SessionDetail, ToolType };
