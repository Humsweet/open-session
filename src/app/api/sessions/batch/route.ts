import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getSessionDetail } from '@/lib/parsers';
import { persistSessionSummary } from '@/lib/session-state';
import { generateSummaryWithFallback } from '@/lib/summarizer/service';
import { SummaryEngine } from '@/lib/summarizer/spinner-verbs';
import { extractSummaryTitle } from '@/lib/summarizer/summary-format';

type BatchAction = 'summarize' | 'close' | 'apply-title';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as BatchAction;
    const ids = Array.isArray(body.ids)
      ? (body.ids as unknown[]).filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];

    if (!['summarize', 'close', 'apply-title'].includes(action)) {
      return NextResponse.json({ error: 'Invalid batch action' }, { status: 400 });
    }

    if (ids.length === 0) {
      return NextResponse.json({ error: 'No session ids provided' }, { status: 400 });
    }

    if (action === 'close') {
      const db = getDb();
      const closeMany = db.transaction((sessionIds: string[]) => {
        const statement = db.prepare(`
          INSERT INTO session_state (session_id, status, status_updated_at, updated_at)
          VALUES (?, 'closed', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
          ON CONFLICT(session_id) DO UPDATE SET
            status = excluded.status,
            status_updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        `);

        for (const id of sessionIds) {
          statement.run(id);
        }
      });

      closeMany(ids);

      return NextResponse.json({
        successCount: ids.length,
        failureCount: 0,
        results: ids.map(id => ({ id, success: true })),
      });
    }

    if (action === 'apply-title') {
      const db = getDb();
      const stateRows = db.prepare(`
        SELECT session_id, summary
        FROM session_state
        WHERE session_id IN (${ids.map(() => '?').join(', ')})
      `).all(...ids) as Array<{ session_id: string; summary: string | null }>;

      const summaryMap = new Map(stateRows.map(row => [row.session_id, row.summary]));
      const updateTitle = db.prepare(`
        INSERT INTO session_state (session_id, status, custom_title, summary_title_applied, updated_at)
        VALUES (?, COALESCE((SELECT status FROM session_state WHERE session_id = ?), 'open'), ?, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        ON CONFLICT(session_id) DO UPDATE SET
          custom_title = excluded.custom_title,
          summary_title_applied = 1,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      `);

      const results = ids.map(id => {
        const title = extractSummaryTitle(summaryMap.get(id) || undefined);
        if (!title) {
          return { id, success: false, error: 'No summary title available' };
        }

        updateTitle.run(id, id, title);
        return { id, success: true };
      });

      const successCount = results.filter(result => result.success).length;
      const failureCount = results.length - successCount;
      return NextResponse.json({ successCount, failureCount, results });
    }

    const db = getDb();
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'summary_cli'").get() as { value: string } | undefined;
    const engine = (setting?.value || 'claude-code') as SummaryEngine;

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const id of ids) {
      try {
        const detail = await getSessionDetail(id);
        if (!detail) {
          throw new Error('Session not found');
        }

        const result = await generateSummaryWithFallback(detail, engine);
        persistSessionSummary(id, result.summary);
        results.push({ id, success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({ id, success: false, error: message });
      }
    }

    const successCount = results.filter(result => result.success).length;
    const failureCount = results.length - successCount;

    return NextResponse.json({ successCount, failureCount, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
