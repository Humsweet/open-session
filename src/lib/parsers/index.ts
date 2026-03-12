import { ClaudeParser } from './claude-parser';
import { CopilotParser } from './copilot-parser';
import { CodexParser } from './codex-parser';
import { GeminiParser } from './gemini-parser';
import { UnifiedSession, SessionDetail, ToolType } from './types';

const parsers = {
  'claude-code': new ClaudeParser(),
  'copilot-cli': new CopilotParser(),
  'codex-cli': new CodexParser(),
  'gemini-cli': new GeminiParser(),
};

export async function scanAllSessions(toolFilter?: ToolType): Promise<UnifiedSession[]> {
  const tools = toolFilter ? [toolFilter] : Object.keys(parsers) as ToolType[];
  const results = await Promise.all(
    tools.map(tool => parsers[tool].scan().catch(() => [] as UnifiedSession[]))
  );
  return results.flat().sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
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
  return parsers[toolType].getDetail(sessionId);
}

export type { UnifiedSession, SessionDetail, ToolType };
