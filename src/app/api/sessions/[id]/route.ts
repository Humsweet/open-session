import { NextRequest, NextResponse } from 'next/server';
import { getSessionDetail } from '@/lib/parsers';
import { getDb } from '@/lib/db/client';
import { persistSessionsClosed } from '@/lib/session-state';
import { isSummaryHelperSession } from '@/lib/summarizer/session-kind';

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

    const forcedClosed = isSummaryHelperSession(detail);
    if (forcedClosed) {
      persistSessionsClosed([id]);
    }

    // Merge persisted state
    const db = getDb();
    const state = db.prepare('SELECT * FROM session_state WHERE session_id = ?').get(id) as {
      status: string;
      summary: string | null;
      custom_title: string | null;
    } | undefined;

    if (state) {
      detail.status = forcedClosed ? 'closed' : state.status as 'open' | 'closed';
      if (state.summary) detail.summary = state.summary;
      if (state.custom_title) detail.title = state.custom_title;
    } else if (forcedClosed) {
      detail.status = 'closed';
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
    const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
    const hasCustomTitle = Object.prototype.hasOwnProperty.call(body, 'customTitle');

    if (!hasStatus && !hasCustomTitle) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const status = hasStatus ? body.status : 'open';
    const customTitle =
      hasCustomTitle && typeof body.customTitle === 'string'
        ? body.customTitle.trim() || null
        : null;

    const db = getDb();
    const detail = await getSessionDetail(id);
    const forcedStatus =
      detail && isSummaryHelperSession(detail) ? 'closed' : status;

    db.prepare(`
      INSERT INTO session_state (session_id, status, custom_title, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        status = CASE
          WHEN ? THEN excluded.status
          ELSE session_state.status
        END,
        custom_title = CASE
          WHEN ? THEN excluded.custom_title
          ELSE session_state.custom_title
        END,
        updated_at = datetime('now')
    `).run(id, forcedStatus, customTitle, hasStatus ? 1 : 0, hasCustomTitle ? 1 : 0);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
