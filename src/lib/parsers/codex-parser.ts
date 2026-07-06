import * as fs from 'fs';
import * as path from 'path';
import { UnifiedSession, SessionDetail, SessionMessage, SessionParser } from './types';
import { getCachedSession, setCachedSession } from './scan-cache';
import { codexRoots, selectRoots, HostFilter } from './session-roots';
import { safeReaddirDirents } from './safe-fs';

export class CodexParser implements SessionParser {
  async scan(hostFilter: HostFilter = 'all', includeArchived = true): Promise<UnifiedSession[]> {
    const sessions: UnifiedSession[] = [];

    for (const { dir: sessionsDir, archived, host } of selectRoots(codexRoots(), hostFilter, includeArchived)) {
      if (!fs.existsSync(sessionsDir)) continue;
      const jsonlFiles = this.findJsonlFiles(sessionsDir);

      for (const filePath of jsonlFiles) {
        try {
        const fileStat = fs.statSync(filePath);
        const cached = getCachedSession(filePath, fileStat);
        if (cached) {
          sessions.push(cached);
          continue;
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length === 0) continue;

        let sessionId = '';
        let cwd = '';
        let createdAt = '';
        let updatedAt = '';
        let firstUserMessage = '';
        let lastUserMessage = '';
        let messageCount = 0;
        let title = '';
        let originator = '';

        for (const line of lines) {
          try {
            const obj = JSON.parse(line);

            if (obj.type === 'session_meta' && !sessionId) {
              sessionId = obj.payload?.id || path.basename(filePath, '.jsonl');
              cwd = obj.payload?.cwd || '';
              createdAt = obj.timestamp || '';
              originator = obj.payload?.originator || '';
            }

            if (obj.type === 'response_item' && obj.payload?.role === 'user') {
              const contentArr = obj.payload?.content;
              if (Array.isArray(contentArr)) {
                for (const block of contentArr) {
                  if (block.type === 'input_text' && block.text && !block.text.startsWith('<')) {
                    messageCount++;
                    if (!firstUserMessage) firstUserMessage = block.text.slice(0, 500);
                    lastUserMessage = block.text.slice(0, 500);
                  }
                }
              } else if (typeof contentArr === 'object' && contentArr?.type === 'input_text') {
                if (contentArr.text && !contentArr.text.startsWith('<')) {
                  messageCount++;
                  if (!firstUserMessage) firstUserMessage = contentArr.text.slice(0, 500);
                  lastUserMessage = contentArr.text.slice(0, 500);
                }
              }
            }

            if (obj.type === 'event_msg' && obj.payload?.type === 'agent_message') {
              messageCount++;
            }

            if (obj.timestamp) updatedAt = obj.timestamp;
          } catch { /* skip */ }
        }

        if (!sessionId) sessionId = path.basename(filePath, '.jsonl');
        if (!createdAt) {
          createdAt = fileStat.birthtime.toISOString();
        }
        if (!updatedAt) updatedAt = createdAt;

        title = firstUserMessage.slice(0, 80) || `Codex Session ${sessionId.slice(0, 8)}`;

        const session: UnifiedSession = {
          id: `codex-${sessionId}`,
          tool: 'codex-cli',
          status: 'open',
          origin: 'local',
          archived,
          host,
          originator: originator || undefined,
          title,
          cwd: cwd.replace(/^\\\\\?\\/, ''),
          createdAt,
          updatedAt,
          messageCount,
          firstUserMessage,
          lastUserMessage,
          rawPath: filePath,
        };
        setCachedSession(filePath, fileStat, session);
        sessions.push({ ...session });
        } catch { /* skip */ }
      }
    }

    return sessions;
  }

  private findJsonlFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = safeReaddirDirents(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.findJsonlFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  async getDetail(sessionId: string): Promise<SessionDetail | null> {
    const sessions = await this.scan();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return null;

    const content = fs.readFileSync(session.rawPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const messages: SessionMessage[] = [];

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);

        if (obj.type === 'response_item' && obj.payload?.role === 'user') {
          const contentArr = obj.payload?.content;
          const texts: string[] = [];
          if (Array.isArray(contentArr)) {
            for (const block of contentArr) {
              if (block.type === 'input_text' && block.text && !block.text.startsWith('<')) {
                texts.push(block.text);
              }
            }
          }
          if (texts.length > 0) {
            messages.push({
              role: 'user',
              content: texts.join('\n'),
              timestamp: obj.timestamp,
            });
          }
        }

        if (obj.type === 'event_msg' && obj.payload?.type === 'agent_reasoning') {
          messages.push({
            role: 'assistant',
            content: `[Thinking] ${obj.payload?.summary || obj.payload?.text || ''}`,
            timestamp: obj.timestamp,
          });
        }

        if (obj.type === 'event_msg' && obj.payload?.type === 'agent_message') {
          messages.push({
            role: 'assistant',
            content: obj.payload?.message || obj.payload?.text || '',
            timestamp: obj.timestamp,
          });
        }

        if (obj.type === 'response_item' && obj.payload?.type === 'function_call') {
          messages.push({
            role: 'tool',
            content: `[Tool: ${obj.payload?.name || 'unknown'}]`,
            timestamp: obj.timestamp,
            toolName: obj.payload?.name,
          });
        }
      } catch { /* skip */ }
    }

    return { ...session, messages };
  }
}
