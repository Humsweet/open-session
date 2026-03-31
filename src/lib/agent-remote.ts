import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { SessionDetail, ToolType, UnifiedSession } from './parsers/types';

const AGENT_REMOTE_DB_PATH = path.join(os.homedir(), '.agent-remote', 'sessions.db');

type AgentRemoteRow = {
  session_id: string;
  channel_id: string;
  cwd: string | null;
  user_id: string | null;
  usage_user_id: string | null;
  usage_agent_type: string | null;
};

type AgentRemoteSessionInfo = {
  agentSource?: string;
  slackThreadTs?: string;
  slackUserId?: string;
};

let agentRemoteDb: Database.Database | null | undefined;

function getAgentRemoteDb(): Database.Database | null {
  if (agentRemoteDb !== undefined) {
    return agentRemoteDb;
  }

  if (!fs.existsSync(AGENT_REMOTE_DB_PATH)) {
    agentRemoteDb = null;
    return agentRemoteDb;
  }

  try {
    agentRemoteDb = new Database(AGENT_REMOTE_DB_PATH, { readonly: true, fileMustExist: true });
  } catch {
    agentRemoteDb = null;
  }

  return agentRemoteDb;
}

function getAgentSource(tool: ToolType, usageAgentType?: string | null): string | undefined {
  const normalizedType = usageAgentType?.trim().toLowerCase();
  if (normalizedType === 'claude' || normalizedType === 'codex') {
    return `slackbot:${normalizedType}`;
  }

  if (tool === 'claude-code') return 'slackbot:claude';
  if (tool === 'codex-cli') return 'slackbot:codex';
  return undefined;
}

function getRealSessionId(sessionId: string): string {
  return sessionId.replace(/^(claude|copilot|codex|gemini)-/, '');
}

function buildAgentRemoteLookup(): Map<string, AgentRemoteRow> {
  const db = getAgentRemoteDb();
  if (!db) return new Map();

  const rows = db.prepare(`
    SELECT
      s.session_id,
      s.channel_id,
      s.cwd,
      s.user_id,
      (
        SELECT u.user_id
        FROM usage_logs u
        WHERE u.session_key = s.channel_id
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT 1
      ) AS usage_user_id,
      (
        SELECT u.agent_type
        FROM usage_logs u
        WHERE u.session_key = s.channel_id
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT 1
      ) AS usage_agent_type
    FROM sessions s
    WHERE s.session_id IS NOT NULL
      AND s.session_id != 'pending'
  `).all() as AgentRemoteRow[];

  return new Map(rows.map(row => [row.session_id, row]));
}

function getAgentRemoteInfo(session: UnifiedSession | SessionDetail, lookup: Map<string, AgentRemoteRow>): AgentRemoteSessionInfo | null {
  const row = lookup.get(getRealSessionId(session.id));
  if (!row) return null;

  const slackUserId = row.user_id || row.usage_user_id || undefined;
  const agentSource = getAgentSource(session.tool, row.usage_agent_type);

  return {
    agentSource,
    slackThreadTs: row.channel_id || undefined,
    slackUserId,
  };
}

export function enrichSessionsWithAgentRemote<T extends UnifiedSession>(sessions: T[]): T[] {
  const lookup = buildAgentRemoteLookup();
  if (lookup.size === 0) {
    return sessions.map(session => ({ ...session, origin: session.origin || 'local' }));
  }

  return sessions.map(session => {
    const info = getAgentRemoteInfo(session, lookup);
    if (!info) {
      return { ...session, origin: 'local' };
    }

    return {
      ...session,
      origin: 'slack-bot',
      ...info,
    };
  });
}

export function enrichSessionDetailWithAgentRemote<T extends SessionDetail>(session: T): T {
  const lookup = buildAgentRemoteLookup();
  const info = getAgentRemoteInfo(session, lookup);
  if (!info) {
    return { ...session, origin: 'local' };
  }

  return {
    ...session,
    origin: 'slack-bot',
    ...info,
  };
}
