import { NextRequest, NextResponse } from 'next/server';
import { getSessionDetail } from '@/lib/parsers';
import { getDb } from '@/lib/db/client';
import { persistSessionStatus, persistSessionsClosed } from '@/lib/session-state';
import { isSummaryHelperSession } from '@/lib/summarizer/session-kind';
import { SessionStatus } from '@/lib/parsers/types';

function hasSessionActivitySinceStatusChange(sessionUpdatedAt: string, statusUpdatedAt?: string | null) {
  if (!statusUpdatedAt) return false;

  const sessionTime = new Date(sessionUpdatedAt).getTime();
  const statusTime = new Date(statusUpdatedAt).getTime();

  if (Number.isNaN(sessionTime) || Number.isNaN(statusTime)) {
    return false;
  }

  return sessionTime > statusTime;
}

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
      summary_title_applied: number;
      pinned: number;
      status_updated_at: string | null;
    } | undefined;

    if (state) {
      const autoReopened =
        !forcedClosed &&
        state.status === 'closed' &&
        hasSessionActivitySinceStatusChange(detail.updatedAt, state.status_updated_at);

      if (autoReopened) {
        persistSessionStatus(id, 'open');
      }

      detail.status = forcedClosed ? 'closed' : autoReopened ? 'open' : state.status as SessionStatus;
      if (state.summary) detail.summary = state.summary;
      if (state.custom_title) detail.title = state.custom_title;
      detail.summaryTitleApplied = Boolean(state.summary_title_applied);
      detail.pinned = Boolean(state.pinned);
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
    const hasApplySummaryTitle = Object.prototype.hasOwnProperty.call(body, 'applySummaryTitle');
    const hasPinned = Object.prototype.hasOwnProperty.call(body, 'pinned');

    if (!hasStatus && !hasCustomTitle && !hasApplySummaryTitle && !hasPinned) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const status = hasStatus ? body.status as SessionStatus : 'open';
    const customTitle =
      hasCustomTitle && typeof body.customTitle === 'string'
        ? body.customTitle.trim() || null
        : null;
    const applySummaryTitle = hasApplySummaryTitle ? Boolean(body.applySummaryTitle) : false;
    const pinned = hasPinned ? Boolean(body.pinned) : false;
    const pinnedAt = hasPinned && pinned ? new Date().toISOString() : null;

    const db = getDb();
    const detail = await getSessionDetail(id);
    const forcedStatus =
      detail && isSummaryHelperSession(detail) ? 'closed' : status;

    db.prepare(`
      INSERT INTO session_state (session_id, status, status_updated_at, custom_title, summary_title_applied, pinned, pinned_at, updated_at)
      VALUES (?, ?, datetime('now'), ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        status = CASE
          WHEN ? THEN excluded.status
          ELSE session_state.status
        END,
        status_updated_at = CASE
          WHEN ? THEN datetime('now')
          ELSE session_state.status_updated_at
        END,
        custom_title = CASE
          WHEN ? THEN excluded.custom_title
          ELSE session_state.custom_title
        END,
        summary_title_applied = CASE
          WHEN ? THEN excluded.summary_title_applied
          WHEN ? THEN 0
          ELSE session_state.summary_title_applied
        END,
        pinned = CASE
          WHEN ? THEN excluded.pinned
          ELSE session_state.pinned
        END,
        pinned_at = CASE
          WHEN ? THEN excluded.pinned_at
          ELSE session_state.pinned_at
        END,
        updated_at = datetime('now')
    `).run(
      id,
      forcedStatus,
      customTitle,
      applySummaryTitle ? 1 : 0,
      pinned ? 1 : 0,
      pinnedAt,
      hasStatus ? 1 : 0,
      hasStatus ? 1 : 0,
      hasCustomTitle ? 1 : 0,
      hasApplySummaryTitle ? 1 : 0,
      hasCustomTitle ? 1 : 0,
      hasPinned ? 1 : 0,
      hasPinned ? 1 : 0
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
