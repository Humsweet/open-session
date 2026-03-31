import * as fs from 'fs';
import * as path from 'path';
import { UnifiedSession, SessionDetail, SessionMessage, SessionParser } from './types';

function getGeminiConversationsDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.gemini', 'antigravity', 'conversations');
}

function getGeminiTmpDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.gemini', 'tmp');
}

interface GeminiMessage {
  id?: string;
  timestamp?: string;
  type: string; // 'user' | 'gemini' | 'model' | 'info' | 'error' | 'tool'
  content?: string | Array<{ text?: string }>;
}

interface GeminiSessionJson {
  sessionId: string;
  projectHash?: string;
  startTime: string;
  lastUpdated: string;
  messages: GeminiMessage[];
  kind?: string; // 'chat' | 'subagent' etc.
}

export class GeminiParser implements SessionParser {
  async scan(): Promise<UnifiedSession[]> {
    const sessions: UnifiedSession[] = [];

    // Scan new JSON format: ~/.gemini/tmp/<project>/chats/session-*.json
    sessions.push(...this.scanJsonSessions());

    // Scan old protobuf format: ~/.gemini/antigravity/conversations/*.pb
    sessions.push(...this.scanPbSessions());

    return sessions;
  }

  private scanJsonSessions(): UnifiedSession[] {
    const tmpDir = getGeminiTmpDir();
    if (!fs.existsSync(tmpDir)) return [];

    const sessions: UnifiedSession[] = [];
    const projectDirs = fs.readdirSync(tmpDir, { withFileTypes: true });

    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const chatsDir = path.join(tmpDir, dir.name, 'chats');
      if (!fs.existsSync(chatsDir)) continue;

      // Read project root for cwd
      let cwd = '';
      const projectRootFile = path.join(tmpDir, dir.name, '.project_root');
      if (fs.existsSync(projectRootFile)) {
        cwd = fs.readFileSync(projectRootFile, 'utf-8').trim();
      }

      const chatFiles = fs.readdirSync(chatsDir).filter(f => f.startsWith('session-') && f.endsWith('.json'));

      for (const file of chatFiles) {
        const filePath = path.join(chatsDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const data: GeminiSessionJson = JSON.parse(content);

          // Skip subagent sessions — they are internal tool calls, not user sessions
          if (data.kind === 'subagent') continue;

          const userMessages = data.messages.filter(m => m.type === 'user');
          const allMessages = data.messages.filter(m => m.type === 'user' || m.type === 'gemini' || m.type === 'model');

          const firstUserText = this.extractText(userMessages[0]);
          const lastUserText = this.extractText(userMessages[userMessages.length - 1]);

          const title = firstUserText.slice(0, 80) || `Gemini Session ${data.sessionId.slice(0, 8)}`;

          sessions.push({
            id: `gemini-${data.sessionId}`,
            tool: 'gemini-cli',
            status: 'open',
            origin: 'local',
            title,
            cwd,
            createdAt: data.startTime,
            updatedAt: data.lastUpdated,
            messageCount: allMessages.length,
            firstUserMessage: firstUserText.slice(0, 500),
            lastUserMessage: lastUserText.slice(0, 500),
            rawPath: filePath,
          });
        } catch { /* skip broken files */ }
      }
    }

    return sessions;
  }

  private scanPbSessions(): UnifiedSession[] {
    const convDir = getGeminiConversationsDir();
    if (!fs.existsSync(convDir)) return [];

    const sessions: UnifiedSession[] = [];
    const files = fs.readdirSync(convDir).filter(f => f.endsWith('.pb'));

    for (const file of files) {
      const filePath = path.join(convDir, file);
      try {
        const stat = fs.statSync(filePath);
        const sessionId = path.basename(file, '.pb');

        sessions.push({
          id: `gemini-pb-${sessionId}`,
          tool: 'gemini-cli',
          status: 'open',
          origin: 'local',
          title: `Gemini Session ${sessionId.slice(0, 8)}`,
          cwd: '',
          createdAt: stat.birthtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          messageCount: 0,
          firstUserMessage: '[Protobuf — content preview unavailable]',
          lastUserMessage: '[Protobuf — content preview unavailable]',
          rawPath: filePath,
        });
      } catch { /* skip */ }
    }

    return sessions;
  }

  private extractText(msg?: GeminiMessage): string {
    if (!msg?.content) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .map(c => c.text || '')
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }

  async getDetail(sessionId: string): Promise<SessionDetail | null> {
    // Try JSON format first
    const jsonDetail = this.getJsonDetail(sessionId);
    if (jsonDetail) return jsonDetail;

    // Fall back to protobuf
    return this.getPbDetail(sessionId);
  }

  private getJsonDetail(sessionId: string): SessionDetail | null {
    const realId = sessionId.replace('gemini-', '');
    const tmpDir = getGeminiTmpDir();
    if (!fs.existsSync(tmpDir)) return null;

    const projectDirs = fs.readdirSync(tmpDir, { withFileTypes: true });
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const chatsDir = path.join(tmpDir, dir.name, 'chats');
      if (!fs.existsSync(chatsDir)) continue;

      const chatFiles = fs.readdirSync(chatsDir).filter(f => f.startsWith('session-') && f.endsWith('.json'));
      for (const file of chatFiles) {
        const filePath = path.join(chatsDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const data: GeminiSessionJson = JSON.parse(content);
          if (data.sessionId !== realId) continue;

          const messages: SessionMessage[] = [];
          for (const msg of data.messages) {
            const text = this.extractText(msg);
            if (!text) continue;

            let role: SessionMessage['role'] = 'system';
            if (msg.type === 'user') role = 'user';
            else if (msg.type === 'gemini' || msg.type === 'model') role = 'assistant';
            else if (msg.type === 'tool') role = 'tool';
            else continue;

            messages.push({
              role,
              content: text,
              timestamp: msg.timestamp,
            });
          }

          let cwd = '';
          const projectRootFile = path.join(tmpDir, dir.name, '.project_root');
          if (fs.existsSync(projectRootFile)) {
            cwd = fs.readFileSync(projectRootFile, 'utf-8').trim();
          }

          const userMessages = data.messages.filter(m => m.type === 'user');
          const firstUserText = this.extractText(userMessages[0]);

          return {
            id: `gemini-${data.sessionId}`,
            tool: 'gemini-cli',
            status: 'open',
            origin: 'local',
            title: firstUserText.slice(0, 80) || `Gemini Session ${data.sessionId.slice(0, 8)}`,
            cwd,
            createdAt: data.startTime,
            updatedAt: data.lastUpdated,
            messageCount: messages.length,
            firstUserMessage: firstUserText.slice(0, 500),
            lastUserMessage: this.extractText(userMessages[userMessages.length - 1]).slice(0, 500),
            rawPath: filePath,
            messages,
          };
        } catch { /* skip broken files */ }
      }
    }
    return null;
  }

  private getPbDetail(sessionId: string): SessionDetail | null {
    const realId = sessionId.replace('gemini-pb-', '');
    const convDir = getGeminiConversationsDir();
    const filePath = path.join(convDir, `${realId}.pb`);
    if (!fs.existsSync(filePath)) return null;

    const stat = fs.statSync(filePath);
    const messages: SessionMessage[] = [
      {
        role: 'system',
        content: 'Gemini CLI conversations are stored in Protocol Buffer format. Full message decoding is not yet supported. File size: ' +
          (stat.size / 1024).toFixed(1) + ' KB',
      },
    ];

    return {
      id: `gemini-pb-${realId}`,
      tool: 'gemini-cli',
      status: 'open',
      origin: 'local',
      title: `Gemini Session ${realId.slice(0, 8)}`,
      cwd: '',
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
      messageCount: 0,
      firstUserMessage: '[Protobuf — content preview unavailable]',
      lastUserMessage: '[Protobuf — content preview unavailable]',
      rawPath: filePath,
      messages,
    };
  }
}
