import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { SessionDetail, ToolType, UnifiedSession } from './parsers/types';

const AGENT_REMOTE_DB_PATH = path.join(os.homedir(), '.agent-remote', 'sessions.db');

type SessionIdRow = {
  session_id: string;
  channel_id: string;
};

type SessionRow = {
  channel_id: string;
  user_id: string | null;
};

type UsageRow = {
  user_id: string | null;
  agent_type: string | null;
};

type AgentRemoteSessionInfo = {
  agentSource?: string;
  slackThreadTs?: string;
  slackChannelId?: string;
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

function hasSessionIdsTable(db: Database.Database): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='session_ids'"
  ).get() as { name: string } | undefined;
  return !!row;
}

/**
 * Build lookup from session_id → channel_id using the session_ids history table.
 * Falls back to the sessions table if session_ids doesn't exist yet.
 */
function buildSessionIdLookup(db: Database.Database): Map<string, string> {
  if (hasSessionIdsTable(db)) {
    const rows = db.prepare(
      'SELECT session_id, channel_id FROM session_ids'
    ).all() as SessionIdRow[];
    return new Map(rows.map(r => [r.session_id, r.channel_id]));
  }

  // Fallback: old schema without session_ids table
  const rows = db.prepare(
    "SELECT session_id, channel_id FROM sessions WHERE session_id IS NOT NULL AND session_id != 'pending'"
  ).all() as SessionIdRow[];
  return new Map(rows.map(r => [r.session_id, r.channel_id]));
}

/**
 * Build lookup from channel_id → session metadata (user_id, usage info).
 */
function buildChannelLookup(db: Database.Database): Map<string, { userId?: string; agentType?: string }> {
  const rows = db.prepare(`
    SELECT
      s.channel_id,
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
  `).all() as Array<{
    channel_id: string;
    user_id: string | null;
    usage_user_id: string | null;
    usage_agent_type: string | null;
  }>;

  const map = new Map<string, { userId?: string; agentType?: string }>();
  for (const row of rows) {
    map.set(row.channel_id, {
      userId: row.user_id || row.usage_user_id || undefined,
      agentType: row.usage_agent_type || undefined,
    });
  }
  return map;
}

function getAgentRemoteInfo(
  session: UnifiedSession | SessionDetail,
  sessionIdLookup: Map<string, string>,
  channelLookup: Map<string, { userId?: string; agentType?: string }>,
): AgentRemoteSessionInfo | null {
  const realId = getRealSessionId(session.id);
  const channelId = sessionIdLookup.get(realId);
  if (!channelId) return null;

  const channelInfo = channelLookup.get(channelId);
  const agentSource = getAgentSource(session.tool, channelInfo?.agentType);

  return {
    agentSource,
    slackThreadTs: channelId,
    slackChannelId: channelId,
    slackUserId: channelInfo?.userId,
  };
}

export function enrichSessionsWithAgentRemote<T extends UnifiedSession>(sessions: T[]): T[] {
  const db = getAgentRemoteDb();
  if (!db) {
    return sessions.map(session => ({ ...session, origin: session.origin || 'local' }));
  }

  const sessionIdLookup = buildSessionIdLookup(db);
  if (sessionIdLookup.size === 0) {
    return sessions.map(session => ({ ...session, origin: session.origin || 'local' }));
  }

  const channelLookup = buildChannelLookup(db);

  return sessions.map(session => {
    const info = getAgentRemoteInfo(session, sessionIdLookup, channelLookup);
    if (!info) {
      // Fallback: codex_exec originator means it was spawned by agent-remote
      if (session.originator === 'codex_exec') {
        return {
          ...session,
          origin: 'slack-bot' as const,
          agentSource: getAgentSource(session.tool),
        };
      }
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
  const db = getAgentRemoteDb();
  if (!db) {
    return { ...session, origin: 'local' };
  }

  const sessionIdLookup = buildSessionIdLookup(db);
  const channelLookup = buildChannelLookup(db);
  const info = getAgentRemoteInfo(session, sessionIdLookup, channelLookup);
  if (!info) {
    return { ...session, origin: 'local' };
  }

  return {
    ...session,
    origin: 'slack-bot',
    ...info,
  };
}
