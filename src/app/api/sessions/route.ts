import { NextRequest, NextResponse } from 'next/server';
import { scanAllSessions, ToolType } from '@/lib/parsers';
import { getDb } from '@/lib/db/client';
import { SessionOrigin, SessionStatus } from '@/lib/parsers/types';
import { persistSessionStatus, persistSessionsClosed } from '@/lib/session-state';
import { isSummaryHelperSession } from '@/lib/summarizer/session-kind';

function parseAsUtc(s: string): number {
  // SQLite datetime('now') produces "YYYY-MM-DD HH:MM:SS" without timezone —
  // JS parses that as local time. Normalize to UTC by appending 'Z'.
  if (s && !s.endsWith('Z') && !s.includes('+') && !s.includes('T')) {
    return new Date(s.replace(' ', 'T') + 'Z').getTime();
  }
  return new Date(s).getTime();
}

function hasSessionActivitySinceStatusChange(sessionUpdatedAt: string, statusUpdatedAt?: string | null) {
  if (!statusUpdatedAt) return false;

  const sessionTime = parseAsUtc(sessionUpdatedAt);
  const statusTime = parseAsUtc(statusUpdatedAt);

  if (Number.isNaN(sessionTime) || Number.isNaN(statusTime)) {
    return false;
  }

  return sessionTime > statusTime;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const toolFilter = searchParams.get('tool') as ToolType | null;
    const statusFilter = searchParams.get('status') as SessionStatus | null;
    const originFilter = searchParams.get('origin') as SessionOrigin | null;
    const pinnedFilter = searchParams.get('pinned');
    const search = searchParams.get('search')?.toLowerCase();
    const sortBy = searchParams.get('sortBy') || 'updatedAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    let sessions = await scanAllSessions(toolFilter || undefined);
    const summaryHelperIds = sessions.filter(isSummaryHelperSession).map(session => session.id);

    if (summaryHelperIds.length > 0) {
      persistSessionsClosed(summaryHelperIds);
    }

    // Merge with persisted state from DB
    const db = getDb();
    const states = db.prepare('SELECT * FROM session_state').all() as Array<{
      session_id: string;
      status: string;
      summary: string | null;
      custom_title: string | null;
      summary_title_applied: number;
      pinned: number;
      status_updated_at: string | null;
    }>;
    const stateMap = new Map(states.map(s => [s.session_id, s]));

    sessions = sessions.map(s => {
      const state = stateMap.get(s.id);
      const forcedClosed = isSummaryHelperSession(s);
      const autoReopened =
        !forcedClosed &&
        state?.status === 'closed' &&
        hasSessionActivitySinceStatusChange(s.updatedAt, state.status_updated_at);

      if (autoReopened) {
        persistSessionStatus(s.id, 'open');
      }

      return {
        ...s,
        status: forcedClosed ? 'closed' : autoReopened ? 'open' : (state?.status as SessionStatus) || s.status,
        summary: state?.summary || s.summary,
        title: state?.custom_title || s.title,
        summaryTitleApplied: Boolean(state?.summary_title_applied),
        pinned: Boolean(state?.pinned),
      };
    });

    // Apply filters
    if (statusFilter) {
      sessions = sessions.filter(s => s.status === statusFilter);
    }

    if (originFilter) {
      sessions = sessions.filter(s => s.origin === originFilter);
    }

    if (pinnedFilter === 'only') {
      sessions = sessions.filter(s => s.pinned);
    }

    if (search) {
      sessions = sessions.filter(s =>
        s.title.toLowerCase().includes(search) ||
        s.firstUserMessage.toLowerCase().includes(search) ||
        s.cwd.toLowerCase().includes(search)
      );
    }

    // Apply sorting
    const field = sortBy as 'updatedAt' | 'createdAt';
    sessions.sort((a, b) => {
      const pinnedDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      if (pinnedDiff !== 0) return pinnedDiff;

      const ta = new Date(a[field] || a.updatedAt).getTime();
      const tb = new Date(b[field] || b.updatedAt).getTime();
      return sortOrder === 'asc' ? ta - tb : tb - ta;
    });

    return NextResponse.json({ sessions, total: sessions.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
