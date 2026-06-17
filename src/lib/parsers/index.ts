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

  if (candidate.messageCount !== current.messageCount) {
    return candidate.messageCount > current.messageCount ? candidate : current;
  }

  // Equal content found in two roots (live local + backup SSD): keep the live
  // (non-archived) copy as the one displayed, so the row reads as live, not
  // archived. A session found ONLY in the backup keeps archived=true — that is
  // the cleaned-up-locally history this feature exists to recover.
  if (Boolean(current.archived) !== Boolean(candidate.archived)) {
    return current.archived ? candidate : current;
  }

  return current;
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

/**
 * Metadata-only lookup (no message parsing). Cheap when the scan cache is
 * warm — use instead of getSessionDetail when messages aren't needed.
 */
export async function getSessionLite(sessionId: string): Promise<UnifiedSession | null> {
  const tool = sessionId.split('-')[0];
  const toolMap: Record<string, ToolType> = {
    claude: 'claude-code',
    copilot: 'copilot-cli',
    codex: 'codex-cli',
    gemini: 'gemini-cli',
  };
  const toolType = toolMap[tool];
  if (!toolType) return null;
  const sessions = await parsers[toolType].scan().catch(() => [] as UnifiedSession[]);
  return sessions.find(s => s.id === sessionId) || null;
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
