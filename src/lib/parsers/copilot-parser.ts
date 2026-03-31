import * as fs from 'fs';
import * as path from 'path';
import { UnifiedSession, SessionDetail, SessionMessage, SessionParser } from './types';

function getCopilotSessionDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.copilot', 'session-state');
}

export class CopilotParser implements SessionParser {
  async scan(): Promise<UnifiedSession[]> {
    const sessionDir = getCopilotSessionDir();
    if (!fs.existsSync(sessionDir)) return [];

    const sessions: UnifiedSession[] = [];
    const folders = fs.readdirSync(sessionDir, { withFileTypes: true });

    for (const folder of folders) {
      if (!folder.isDirectory()) continue;
      const eventsPath = path.join(sessionDir, folder.name, 'events.jsonl');
      if (!fs.existsSync(eventsPath)) continue;

      try {
        const content = fs.readFileSync(eventsPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length === 0) continue;

        const sessionId = folder.name;
        let cwd = '';
        let createdAt = '';
        let updatedAt = '';
        let firstUserMessage = '';
        let lastUserMessage = '';
        let messageCount = 0;

        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'session.start') {
              cwd = obj.data?.context?.cwd || '';
              createdAt = obj.timestamp || '';
            }
            if (obj.type === 'user.message') {
              messageCount++;
              const content = obj.data?.content || '';
              if (!firstUserMessage) firstUserMessage = content.slice(0, 500);
              lastUserMessage = content.slice(0, 500);
              updatedAt = obj.timestamp || updatedAt;
            }
            if (obj.type === 'assistant.message') {
              messageCount++;
              updatedAt = obj.timestamp || updatedAt;
            }
          } catch { /* skip */ }
        }

        if (!createdAt) {
          const stat = fs.statSync(eventsPath);
          createdAt = stat.birthtime.toISOString();
        }
        if (!updatedAt) updatedAt = createdAt;

        const title = firstUserMessage.slice(0, 80) || `Copilot Session ${sessionId.slice(0, 8)}`;

        sessions.push({
          id: `copilot-${sessionId}`,
          tool: 'copilot-cli',
          status: 'open',
          origin: 'local',
          title,
          cwd,
          createdAt,
          updatedAt,
          messageCount,
          firstUserMessage,
          lastUserMessage,
          rawPath: eventsPath,
        });
      } catch { /* skip */ }
    }

    return sessions;
  }

  async getDetail(sessionId: string): Promise<SessionDetail | null> {
    const realId = sessionId.replace('copilot-', '');
    const eventsPath = path.join(getCopilotSessionDir(), realId, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) return null;

    const content = fs.readFileSync(eventsPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const messages: SessionMessage[] = [];

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'user.message') {
          messages.push({
            role: 'user',
            content: obj.data?.content || '',
            timestamp: obj.timestamp,
          });
        } else if (obj.type === 'assistant.message') {
          const text = obj.data?.content || obj.data?.text || '';
          if (text) {
            messages.push({
              role: 'assistant',
              content: typeof text === 'string' ? text : JSON.stringify(text),
              timestamp: obj.timestamp,
            });
          }
        } else if (obj.type === 'tool.execution_complete') {
          messages.push({
            role: 'tool',
            content: `[Tool: ${obj.data?.toolName || 'unknown'}] ${(obj.data?.result || '').slice(0, 300)}`,
            timestamp: obj.timestamp,
            toolName: obj.data?.toolName,
          });
        }
      } catch { /* skip */ }
    }

    const sessions = await this.scan();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return null;

    return { ...session, messages };
  }
}
