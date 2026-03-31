import * as fs from 'fs';
import * as path from 'path';
import { UnifiedSession, SessionDetail, SessionMessage, SessionParser } from './types';

function getClaudeProjectsDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.claude', 'projects');
}

function extractFirstUserMessage(lines: string[]): { content: string; timestamp?: string } | null {
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.message?.role === 'user' && obj.type === 'user') {
        const content = typeof obj.message.content === 'string'
          ? obj.message.content
          : JSON.stringify(obj.message.content);
        return { content: content.slice(0, 500), timestamp: obj.timestamp };
      }
    } catch { /* skip */ }
  }
  return null;
}

function extractLastUserMessage(lines: string[]): { content: string; timestamp?: string } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.message?.role === 'user' && obj.type === 'user') {
        const content = typeof obj.message.content === 'string'
          ? obj.message.content
          : JSON.stringify(obj.message.content);
        return { content: content.slice(0, 500), timestamp: obj.timestamp };
      }
    } catch { /* skip */ }
  }
  return null;
}

function parseMessages(lines: string[]): SessionMessage[] {
  const messages: SessionMessage[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!obj.message?.role) continue;
      const role = obj.message.role as SessionMessage['role'];
      if (role !== 'user' && role !== 'assistant') continue;

      let content = '';
      if (typeof obj.message.content === 'string') {
        content = obj.message.content;
      } else if (Array.isArray(obj.message.content)) {
        content = obj.message.content
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text)
          .join('\n');
        if (!content) {
          const toolUse = obj.message.content.find((b: { type: string }) => b.type === 'tool_use');
          if (toolUse) {
            content = `[Tool: ${toolUse.name}]`;
          }
        }
      }

      if (content) {
        messages.push({ role, content, timestamp: obj.timestamp });
      }
    } catch { /* skip */ }
  }
  return messages;
}

export class ClaudeParser implements SessionParser {
  async scan(): Promise<UnifiedSession[]> {
    const projectsDir = getClaudeProjectsDir();
    if (!fs.existsSync(projectsDir)) return [];

    const sessions: UnifiedSession[] = [];
    const projectFolders = fs.readdirSync(projectsDir, { withFileTypes: true });

    for (const folder of projectFolders) {
      if (!folder.isDirectory()) continue;
      const folderPath = path.join(projectsDir, folder.name);
      const jsonlFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl') && !f.includes('subagents'));

      for (const file of jsonlFiles) {
        const filePath = path.join(folderPath, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n').filter(l => l.trim());
          if (lines.length === 0) continue;

          const sessionId = path.basename(file, '.jsonl');

          // Extract metadata from first message-like line
          let cwd = '';
          let createdAt = '';
          let updatedAt = '';
          let slug = '';
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.cwd && !cwd) cwd = obj.cwd;
              if (obj.slug && !slug) slug = obj.slug;
              break;
            } catch { /* skip */ }
          }

          const firstMsg = extractFirstUserMessage(lines);
          const lastMsg = extractLastUserMessage(lines);
          const messageCount = lines.filter(l => {
            try {
              const o = JSON.parse(l);
              return o.message?.role === 'user' || o.message?.role === 'assistant';
            } catch { return false; }
          }).length;

          const stat = fs.statSync(filePath);
          createdAt = firstMsg?.timestamp || stat.birthtime.toISOString();
          updatedAt = lastMsg?.timestamp || stat.mtime.toISOString();

          const title = slug
            ? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            : (firstMsg?.content.slice(0, 80) || sessionId);

          sessions.push({
            id: `claude-${sessionId}`,
            tool: 'claude-code',
            status: 'open',
            origin: 'local',
            title,
            cwd,
            createdAt,
            updatedAt,
            messageCount,
            firstUserMessage: firstMsg?.content || '',
            lastUserMessage: lastMsg?.content || '',
            rawPath: filePath,
          });
        } catch { /* skip broken files */ }
      }
    }

    return sessions;
  }

  async getDetail(sessionId: string): Promise<SessionDetail | null> {
    const realId = sessionId.replace('claude-', '');
    const projectsDir = getClaudeProjectsDir();
    if (!fs.existsSync(projectsDir)) return null;

    const projectFolders = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const folder of projectFolders) {
      if (!folder.isDirectory()) continue;
      const filePath = path.join(projectsDir, folder.name, `${realId}.jsonl`);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      const messages = parseMessages(lines);

      const sessions = await this.scan();
      const session = sessions.find(s => s.id === sessionId);
      if (!session) return null;

      return { ...session, messages };
    }
    return null;
  }
}
