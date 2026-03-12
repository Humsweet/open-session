import * as fs from 'fs';
import * as path from 'path';
import { UnifiedSession, SessionDetail, SessionMessage, SessionParser } from './types';

function getGeminiConversationsDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.gemini', 'antigravity', 'conversations');
}

export class GeminiParser implements SessionParser {
  async scan(): Promise<UnifiedSession[]> {
    const convDir = getGeminiConversationsDir();
    if (!fs.existsSync(convDir)) return [];

    const sessions: UnifiedSession[] = [];
    const files = fs.readdirSync(convDir).filter(f => f.endsWith('.pb'));

    for (const file of files) {
      const filePath = path.join(convDir, file);
      try {
        const stat = fs.statSync(filePath);
        const sessionId = path.basename(file, '.pb');

        // Protobuf files can't be fully decoded without schema.
        // Extract what we can from file metadata.
        sessions.push({
          id: `gemini-${sessionId}`,
          tool: 'gemini-cli',
          status: 'open',
          title: `Gemini Session ${sessionId.slice(0, 8)}`,
          cwd: '',
          createdAt: stat.birthtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          messageCount: 0, // Unknown without protobuf decode
          firstUserMessage: '[Protobuf — content preview unavailable]',
          lastUserMessage: '[Protobuf — content preview unavailable]',
          rawPath: filePath,
        });
      } catch { /* skip */ }
    }

    return sessions;
  }

  async getDetail(sessionId: string): Promise<SessionDetail | null> {
    const sessions = await this.scan();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return null;

    const messages: SessionMessage[] = [
      {
        role: 'system',
        content: 'Gemini CLI conversations are stored in Protocol Buffer format. Full message decoding is not yet supported. File size: ' +
          (fs.statSync(session.rawPath).size / 1024).toFixed(1) + ' KB',
      },
    ];

    return { ...session, messages };
  }
}
