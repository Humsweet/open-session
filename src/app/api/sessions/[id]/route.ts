import { NextRequest, NextResponse } from 'next/server';
import { getSessionDetail } from '@/lib/parsers';
import { getDb } from '@/lib/db/client';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const detail = await getSessionDetail(id);
    if (!detail) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Merge persisted state
    const db = getDb();
    const state = db.prepare('SELECT * FROM session_state WHERE session_id = ?').get(id) as {
      status: string;
      summary: string | null;
      custom_title: string | null;
    } | undefined;

    if (state) {
      detail.status = state.status as 'open' | 'closed' | 'dropped';
      if (state.summary) detail.summary = state.summary;
      if (state.custom_title) detail.title = state.custom_title;
    }

    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, customTitle } = body;

    const db = getDb();
    db.prepare(`
      INSERT INTO session_state (session_id, status, custom_title, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        status = COALESCE(excluded.status, session_state.status),
        custom_title = COALESCE(excluded.custom_title, session_state.custom_title),
        updated_at = datetime('now')
    `).run(id, status || 'open', customTitle || null);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
