import * as fs from 'fs';
import * as path from 'path';
import { UnifiedSession, SessionDetail, SessionMessage, SessionParser } from './types';
import { getCachedSession, setCachedSession } from './scan-cache';

function getClaudeProjectsDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.claude', 'projects');
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: { type?: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text || '')
      .join(' ');
  }
  return '';
}

/** Drop harness-injected wrappers so titles/snippets show what the user actually typed */
function cleanMessageText(text: string): string {
  return text
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .trim();
}

interface ParsedEntry {
  message?: { role?: string; content?: unknown };
  type?: string;
  isMeta?: boolean;
  timestamp?: string;
  cwd?: string;
  slug?: string;
}

function extractUserMessage(obj: ParsedEntry): { content: string; timestamp?: string } | null {
  if (obj.message?.role !== 'user' || obj.type !== 'user' || obj.isMeta) return null;
  const raw = extractMessageText(obj.message.content);
  if (raw.includes('<command-name>') || raw.includes('<local-command')) return null;
  const text = cleanMessageText(raw);
  if (!text) return null;
  return { content: text.slice(0, 500), timestamp: obj.timestamp };
}

function parseMessages(lines: string[]): SessionMessage[] {
  const messages: SessionMessage[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!obj.message?.role) continue;

      const role = obj.message.role as string;
      if (role !== 'user' && role !== 'assistant') continue;
      if (obj.isMeta) continue;

      const content = obj.message.content;
      const timestamp = obj.timestamp;
      const rawEntry = JSON.stringify(obj);
      const rawJson = rawEntry.length > 16384 ? rawEntry.slice(0, 16384) + '...(truncated)' : rawEntry;

      if (typeof content === 'string') {
        if (content.includes('<command-name>') || content.includes('<local-command')) continue;
        messages.push({
          role: role as SessionMessage['role'],
          blockType: 'text',
          content,
          timestamp,
          rawJson,
        });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          switch (block.type) {
            case 'text':
              if (block.text) {
                messages.push({
                  role: role as SessionMessage['role'],
                  blockType: 'text',
                  content: block.text,
                  timestamp,
                  rawJson,
                });
              }
              break;

            case 'thinking':
              messages.push({
                role: 'assistant',
                blockType: 'thinking',
                content: block.thinking || '',
                isRedacted: !block.thinking,
                timestamp,
                rawJson,
              });
              break;

            case 'tool_use':
              messages.push({
                role: 'assistant',
                blockType: 'tool_call',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                toolCallId: block.id,
                timestamp,
                rawJson,
              });
              break;

            case 'tool_result': {
              let resultContent = '';
              if (typeof block.content === 'string') {
                resultContent = block.content;
              } else if (Array.isArray(block.content)) {
                resultContent = block.content
                  .map((c: { text?: string }) => c.text || '')
                  .join('\n');
              }
              messages.push({
                role: 'user',
                blockType: 'tool_result',
                content: resultContent,
                isError: block.is_error || false,
                toolCallId: block.tool_use_id,
                timestamp,
                rawJson,
              });
              break;
            }
          }
        }
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
          const stat = fs.statSync(filePath);
          const cached = getCachedSession(filePath, stat);
          if (cached) {
            sessions.push(cached);
            continue;
          }

          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n').filter(l => l.trim());
          if (lines.length === 0) continue;

          const sessionId = path.basename(file, '.jsonl');

          // Single pass: metadata, message count, and first/last user message
          let cwd = '';
          let slug = '';
          let messageCount = 0;
          let firstMsg: { content: string; timestamp?: string } | null = null;
          let lastMsg: { content: string; timestamp?: string } | null = null;

          for (const line of lines) {
            let obj: ParsedEntry;
            try {
              obj = JSON.parse(line);
            } catch { continue; }

            if (obj.cwd && !cwd) cwd = obj.cwd;
            if (obj.slug && !slug) slug = obj.slug;

            const role = obj.message?.role;
            if (role === 'user' || role === 'assistant') messageCount++;

            const msg = extractUserMessage(obj);
            if (msg) {
              if (!firstMsg) firstMsg = msg;
              lastMsg = msg;
            }
          }

          const createdAt = firstMsg?.timestamp || stat.birthtime.toISOString();
          const updatedAt = lastMsg?.timestamp || stat.mtime.toISOString();

          const title = slug
            ? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            : (firstMsg?.content.slice(0, 80) || sessionId);

          const session: UnifiedSession = {
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
          };
          setCachedSession(filePath, stat, session);
          sessions.push({ ...session });
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
