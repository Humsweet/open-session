import { getDb } from './db/client';
import { SessionStatus } from './parsers/types';

export function persistSessionStatus(sessionId: string, status: SessionStatus) {
  const db = getDb();
  db.prepare(`
    INSERT INTO session_state (session_id, status, status_updated_at, updated_at)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    ON CONFLICT(session_id) DO UPDATE SET
      status = excluded.status,
      status_updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  `).run(sessionId, status);
}

export function persistSessionSummary(sessionId: string, summary: string) {
  const db = getDb();
  const existing = db
    .prepare('SELECT status, custom_title FROM session_state WHERE session_id = ?')
    .get(sessionId) as { status: SessionStatus; custom_title: string | null } | undefined;

  db.prepare(`
    INSERT INTO session_state (session_id, status, summary, custom_title, summary_title_applied, updated_at)
    VALUES (?, ?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    ON CONFLICT(session_id) DO UPDATE SET
      summary = excluded.summary,
      summary_title_applied = 0,
      updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  `).run(sessionId, existing?.status || 'open', summary, existing?.custom_title || null);
}

export function persistSessionsClosed(sessionIds: string[]) {
  if (sessionIds.length === 0) return;

  const db = getDb();
  const closeMany = db.transaction((ids: string[]) => {
    const statement = db.prepare(`
      INSERT INTO session_state (session_id, status, status_updated_at, updated_at)
      VALUES (?, 'closed', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      ON CONFLICT(session_id) DO UPDATE SET
        status = 'closed',
        status_updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    `);

    for (const id of ids) {
      statement.run(id);
    }
  });

  closeMany(sessionIds);
}
