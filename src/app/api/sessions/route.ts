import { NextRequest, NextResponse } from 'next/server';
import { scanAllSessions, ToolType } from '@/lib/parsers';
import { getDb } from '@/lib/db/client';
import { SessionOrigin } from '@/lib/parsers/types';
import { persistSessionsClosed } from '@/lib/session-state';
import { isSummaryHelperSession } from '@/lib/summarizer/session-kind';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const toolFilter = searchParams.get('tool') as ToolType | null;
    const statusFilter = searchParams.get('status') as 'open' | 'closed' | null;
    const originFilter = searchParams.get('origin') as SessionOrigin | null;
    const search = searchParams.get('search')?.toLowerCase();

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
    }>;
    const stateMap = new Map(states.map(s => [s.session_id, s]));

    sessions = sessions.map(s => {
      const state = stateMap.get(s.id);
      const forcedClosed = isSummaryHelperSession(s);
      return {
        ...s,
        status: forcedClosed ? 'closed' : (state?.status as 'open' | 'closed') || s.status,
        summary: state?.summary || s.summary,
        title: state?.custom_title || s.title,
      };
    });

    // Apply filters
    if (statusFilter) {
      sessions = sessions.filter(s => s.status === statusFilter);
    }

    if (originFilter) {
      sessions = sessions.filter(s => s.origin === originFilter);
    }

    if (search) {
      sessions = sessions.filter(s =>
        s.title.toLowerCase().includes(search) ||
        s.firstUserMessage.toLowerCase().includes(search) ||
        s.cwd.toLowerCase().includes(search)
      );
    }

    return NextResponse.json({ sessions, total: sessions.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
