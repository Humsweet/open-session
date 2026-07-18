import * as fs from 'fs';
import * as path from 'path';
import { UnifiedSession, SessionDetail, SessionMessage, SessionParser } from './types';
import { getCachedSession, setCachedSession } from './scan-cache';
import { grokRoots, selectRoots, HostFilter } from './session-roots';
import { safeReaddir, safeReaddirDirents } from './safe-fs';

interface GrokSummary {
  info: { id: string; cwd: string };
  session_summary?: string;
  generated_title?: string;
  created_at: string;
  last_active_at?: string;
  updated_at?: string;
  num_messages?: number;
  num_chat_messages?: number;
  current_model_id?: string;
}

interface GrokChatLine {
  type: 'system' | 'user' | 'assistant';
  content?: string | Array<{ type?: string; text?: string }>;
}

function extractText(content: GrokChatLine['content']): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join(' ')
      .trim();
  }
  return '';
}

function parseUserMessages(chatPath: string): { first: string; last: string } {
  let first = '';
  let last = '';
  try {
    const lines = fs.readFileSync(chatPath, 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj: GrokChatLine = JSON.parse(line);
        if (obj.type !== 'user') continue;
        const text = extractText(obj.content).slice(0, 500);
        if (!text) continue;
        if (!first) first = text;
        last = text;
      } catch { /* skip */ }
    }
  } catch { /* skip unreadable */ }
  return { first, last };
}

export class GrokParser implements SessionParser {
  async scan(hostFilter: HostFilter = 'all', includeArchived = true): Promise<UnifiedSession[]> {
    const sessions: UnifiedSession[] = [];

    for (const { dir: sessionsDir, archived, host } of selectRoots(grokRoots(), hostFilter, includeArchived)) {
      if (!fs.existsSync(sessionsDir)) continue;
      const cwdDirs = safeReaddirDirents(sessionsDir);

      for (const cwdDir of cwdDirs) {
        if (!cwdDir.isDirectory()) continue;
        const cwdDirPath = path.join(sessionsDir, cwdDir.name);
        const sessionUuids = safeReaddirDirents(cwdDirPath);

        for (const uuidDir of sessionUuids) {
          if (!uuidDir.isDirectory()) continue;
          const sessionDir = path.join(cwdDirPath, uuidDir.name);
          const summaryPath = path.join(sessionDir, 'summary.json');
          const chatPath = path.join(sessionDir, 'chat_history.jsonl');

          if (!fs.existsSync(summaryPath)) continue;

          // Cache key: chat_history.jsonl (changes as messages are added)
          const cacheTarget = fs.existsSync(chatPath) ? chatPath : summaryPath;
          try {
            const stat = fs.statSync(cacheTarget);
            const cached = getCachedSession(cacheTarget, stat);
            if (cached) {
              sessions.push(cached);
              continue;
            }

            const summary: GrokSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
            const { first, last } = parseUserMessages(chatPath);

            const title =
              summary.generated_title ||
              summary.session_summary ||
              first.slice(0, 80) ||
              `Grok Session ${summary.info.id.slice(0, 8)}`;

            const session: UnifiedSession = {
              id: `grok-${summary.info.id}`,
              tool: 'grok-cli',
              status: 'open',
              origin: 'local',
              archived,
              host,
              title,
              cwd: summary.info.cwd || '',
              createdAt: summary.created_at,
              updatedAt: summary.last_active_at || summary.updated_at || summary.created_at,
              messageCount: summary.num_chat_messages ?? summary.num_messages ?? 0,
              firstUserMessage: first,
              lastUserMessage: last,
              rawPath: sessionDir,
            };

            setCachedSession(cacheTarget, stat, session);
            sessions.push({ ...session });
          } catch { /* skip broken sessions */ }
        }
      }
    }

    return sessions;
  }

  async getDetail(sessionId: string): Promise<SessionDetail | null> {
    const realId = sessionId.replace('grok-', '');

    for (const { dir: sessionsDir, archived, host } of grokRoots()) {
      if (!fs.existsSync(sessionsDir)) continue;
      const cwdDirs = safeReaddirDirents(sessionsDir);

      for (const cwdDir of cwdDirs) {
        if (!cwdDir.isDirectory()) continue;
        const sessionDir = path.join(sessionsDir, cwdDir.name, realId);
        const summaryPath = path.join(sessionDir, 'summary.json');
        const chatPath = path.join(sessionDir, 'chat_history.jsonl');

        if (!fs.existsSync(summaryPath)) continue;

        try {
          const summary: GrokSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
          const messages: SessionMessage[] = [];

          if (fs.existsSync(chatPath)) {
            const lines = fs.readFileSync(chatPath, 'utf-8').split('\n');
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const obj: GrokChatLine = JSON.parse(line);
                if (obj.type === 'system') continue; // skip injected system prompt
                if (obj.type !== 'user' && obj.type !== 'assistant') continue;
                const text = extractText(obj.content);
                if (!text) continue;
                messages.push({
                  role: obj.type,
                  content: text,
                });
              } catch { /* skip */ }
            }
          }

          const userMessages = messages.filter(m => m.role === 'user');
          const first = userMessages[0]?.content.slice(0, 500) || '';
          const last = userMessages[userMessages.length - 1]?.content.slice(0, 500) || '';
          const title =
            summary.generated_title ||
            summary.session_summary ||
            first.slice(0, 80) ||
            `Grok Session ${realId.slice(0, 8)}`;

          return {
            id: `grok-${summary.info.id}`,
            tool: 'grok-cli',
            status: 'open',
            origin: 'local',
            archived,
            host,
            title,
            cwd: summary.info.cwd || '',
            createdAt: summary.created_at,
            updatedAt: summary.last_active_at || summary.updated_at || summary.created_at,
            messageCount: messages.length,
            firstUserMessage: first,
            lastUserMessage: last,
            rawPath: sessionDir,
            messages,
          };
        } catch { /* skip broken session */ }
      }
    }

    return null;
  }
}
